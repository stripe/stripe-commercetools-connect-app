import Stripe from 'stripe';
import { SessionHeaderAuthenticationHook } from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  ConfigElementResponseSchema,
  ConfigElementResponseSchemaDTO,
  PaymentMethodOptionsSchema,
  PaymentMethodOptionsSchemaDTO,
  PaymentResponseSchema,
  PaymentResponseSchemaDTO,
} from '../dtos/stripe-payment.dto';
import { log } from '../libs/logger';
import { stripeApi } from '../clients/stripe.client';
import { StripePaymentService } from '../services/stripe-payment.service';
import { StripeHeaderAuthHook } from '../libs/fastify/hooks/stripe-header-auth.hook';
import { Type } from '@sinclair/typebox';
import { getConfig } from '../config/config';
import {
  PaymentIntentConfirmRequestSchemaDTO,
  PaymentIntentConfirmRequestSchema,
  PaymentIntentConfirmResponseSchemaDTO,
  PaymentIntentResponseSchema,
  PaymentModificationStatus,
} from '../dtos/operations/payment-intents.dto';
import { StripeEvent, StripeSubscriptionEvent } from '../services/types/stripe-payment.type';
import { isBankTransferNextAction, isMicrodepositNextAction, isFromSubscriptionInvoice } from '../utils';
import { StripeSubscriptionService } from '../services/stripe-subscription.service';

type PaymentRoutesOptions = {
  paymentService: StripePaymentService;
  subscriptionService: StripeSubscriptionService;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
};

type StripeRoutesOptions = {
  paymentService: StripePaymentService;
  subscriptionService: StripeSubscriptionService;
  stripeHeaderAuthHook: StripeHeaderAuthHook;
};

export const paymentRoutes = async (fastify: FastifyInstance, opts: FastifyPluginOptions & PaymentRoutesOptions) => {
  // GET /payments - Backward compatible endpoint (no payment method options)
  fastify.get<{ Reply: PaymentResponseSchemaDTO }>(
    '/payments',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        response: {
          200: PaymentResponseSchema,
        },
      },
    },
    async (_, reply) => {
      const resp = await opts.paymentService.createPaymentIntent();
      return reply.status(200).send(resp);
    },
  );

  // POST /payments - New endpoint with payment method options support
  fastify.post<{ Body: PaymentMethodOptionsSchemaDTO; Reply: PaymentResponseSchemaDTO }>(
    '/payments',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        body: PaymentMethodOptionsSchema,
        response: {
          200: PaymentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const resp = await opts.paymentService.createPaymentIntent(request.body);
      return reply.status(200).send(resp);
    },
  );

  fastify.post<{
    Body: PaymentIntentConfirmRequestSchemaDTO;
    Reply: PaymentIntentConfirmResponseSchemaDTO;
    Params: { id: string };
  }>(
    '/confirmPayments/:id',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        params: {
          $id: 'paramsSchema',
          type: 'object',
          properties: {
            id: Type.String(),
          },
          required: ['id'],
        },
        body: PaymentIntentConfirmRequestSchema,
        response: {
          200: PaymentIntentResponseSchema,
          202: PaymentIntentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params; // paymentReference
      try {
        const outcome = await opts.paymentService.updatePaymentIntentStripeSuccessful(request.body.paymentIntent, id);

        const statusCode = outcome === PaymentModificationStatus.PENDING ? 202 : 200;
        return reply.status(statusCode).send({ outcome });
      } catch (error) {
        // Log before rejecting. This catch used to swallow the error entirely, so a 400 reached the
        // browser with no trace of WHY on the server — and the storefront renders that as a stuck
        // spinner, which is indistinguishable from a hang. Diagnosing one cost a full round trip of
        // "is it hanging or failing?" that the log line below answers immediately.
        log.error('confirmPayments rejected the confirmation.', {
          paymentReference: id,
          paymentIntentId: request.body.paymentIntent,
          error,
        });
        return reply.status(400).send({ outcome: PaymentModificationStatus.REJECTED });
      }
    },
  );
};

/**
 * Records a customer cash balance transaction. Observability only — this event is never
 * routed to processStripeEvent.
 *
 * The event object is customer-scoped: it carries no `ct_payment_id`, and deciding which
 * commercetools transaction a reversal should write when the order may already have shipped
 * is a design of its own (deferred past v1). `funding_reversed` and `adjusted_for_overdraft`
 * are nonetheless the only signal that money was withdrawn after we credited the payment, so
 * they are raised at error level to be alertable.
 *
 * The log payload is built field by field on purpose: the raw event carries `sender_name`,
 * `iban_last4`, `account_number_last4` and `sort_code`. Never log the event or
 * `event.data.object` here.
 */
const logCustomerCashBalanceTransaction = (event: Stripe.Event): void => {
  const cashTransaction = event.data.object as Stripe.CustomerCashBalanceTransaction;
  // `applied_to_payment` is populated only on transactions of type `applied_to_payment`.
  // Neither alertable type carries a PaymentIntent: `funding_reversed` has no sub-object at
  // all, and `adjusted_for_overdraft` carries only balance_transaction / linked_transaction.
  // The cash balance transaction id and the linked transaction are therefore logged too —
  // without them an alert has nothing but a customer id to trace which order lost its money.
  const appliedPaymentIntent = cashTransaction.applied_to_payment?.payment_intent;
  const linkedTransaction = cashTransaction.adjusted_for_overdraft?.linked_transaction;
  const details = {
    eventId: event.id,
    eventType: event.type,
    cashBalanceTransactionId: cashTransaction.id,
    transactionType: cashTransaction.type,
    customerId: typeof cashTransaction.customer === 'string' ? cashTransaction.customer : cashTransaction.customer?.id,
    centAmount: cashTransaction.net_amount,
    currencyCode: cashTransaction.currency?.toUpperCase(),
    paymentIntentId: typeof appliedPaymentIntent === 'string' ? appliedPaymentIntent : appliedPaymentIntent?.id,
    linkedTransactionId: typeof linkedTransaction === 'string' ? linkedTransaction : linkedTransaction?.id,
  };

  if (cashTransaction.type === 'funding_reversed' || cashTransaction.type === 'adjusted_for_overdraft') {
    log.error('Cash balance funds withdrawn after the payment was credited — commercetools is not updated', details);
    return;
  }
  log.info('Received customer cash balance transaction', details);
};

/**
 * `payment_intent.requires_action` / `payment_intent.partially_funded` — the async-settlement pending
 * rails (bank transfer and ACH micro-deposits). Extracted from the webhook switch so its two guards,
 * and the reasoning below, do not sit three levels deep inside it.
 *
 * Subscription-driven money is skipped here, and "out of scope" is a decision of OURS rather than a
 * Stripe restriction — Stripe supports bank transfer for recurring payments and lists Subscriptions
 * among the products that can enable it from the Dashboard. Bank transfer does NOT support
 * subscriptions here — see ADR-011. Not a gap awaiting work: a renewal debits a cash balance the
 * shopper must keep pre-funded, and positioning that as a saved auto-charging payment method is the
 * wrong fit. The enabler's paymentMode guard is the other half of the same boundary. Stripe supports
 * the capability; this connector does not expose it. Both statements are true and the distinction
 * matters if anyone revisits this.
 *
 * NOTE the subscription skip only became live on 2026-08-05. isFromSubscriptionInvoice was reading
 * `paymentIntent.invoice`, removed by Stripe in Basil, so it silently returned false and nothing was
 * ever skipped here.
 */
const handleBankTransferPendingEvent = async (
  event: Stripe.Event,
  paymentService: StripePaymentService,
): Promise<void> => {
  if (isFromSubscriptionInvoice(event)) {
    log.info(`${event.type} from subscription invoice — skipped (bank transfer for subscriptions not built)`);
    return;
  }
  // Cast once: both events this handles carry a PaymentIntent, but the parameter is the general
  // Stripe.Event union, which the caller's `case` labels used to narrow.
  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  // Async-settlement rails that must freeze the cart: bank transfer (customer_balance) and ACH
  // micro-deposits (us_bank_account). Both confirm to requires_action and never reach the confirm
  // gate, so this is the only place that can lock the cart before their funds settle days later.
  // Card 3DS (use_stripe_sdk) and Boleto (boleto_display_details) also emit requires_action but must
  // keep the pre-existing log-only behavior — routing them would write an Authorization/Pending for
  // every 3DS payment. The two predicates are deliberately narrow (not one broadened check) so the
  // 3DS/Boleto release-gate tests stay green.
  if (!isBankTransferNextAction(paymentIntent) && !isMicrodepositNextAction(paymentIntent)) {
    log.info(`Received: ${event.type} event of ${paymentIntent.id}`);
    return;
  }
  log.info(`Processing Stripe payment event: ${event.type}`);
  await paymentService.processStripeEvent(event);
  // Commitment point for the async-settlement rails. The shopper now holds wire instructions (bank
  // transfer) or has an ACH debit in flight (micro-deposits) and the funds are days away, so the cart
  // must stop moving — and this is the only place that can do it, since the confirm gate never sees
  // requires_action. Deliberately after processStripeEvent: the payment record matters more than the
  // cart lock if only one succeeds. See freezeCartForBankTransfer and KI-044.
  await paymentService.freezeCartForBankTransfer(event);
};

/**
 * `refund.updated` / `refund.failed`.
 *
 * ONLY the failed outcome is acted on here, and the asymmetry is deliberate rather than
 * half-finished work.
 *
 * charge.refunded already writes Refund/Success, so handling success here too would book the same
 * refund twice — the exact duplication just fixed for subscription invoices. Failure, on the other
 * hand, is currently written NOWHERE: a refund that Stripe later rejects stays recorded in
 * commercetools as successful forever, and the merchant sees money returned that never left. That
 * gap is what this closes.
 *
 * The asymmetry is a stopgap, not the end state. Measured 2026-08-05 on both rails:
 *   card:          refund.created(succeeded) -> charge.refunded -> refund.updated(succeeded)
 *   bank transfer: refund.created(PENDING)   -> charge.refunded -> refund.updated(succeeded)
 * refund.updated therefore fires with the terminal status on every rail and is the natural single
 * owner of the Refund transaction — charge.refunded cannot be, because its payload omits the refunds
 * sublist entirely and so cannot tell pending from succeeded. Moving ownership changes card and
 * subscription behaviour too, so it is a separate decision.
 *
 * Until then a bank-transfer refund is optimistically Success while genuinely pending, and is
 * corrected only if it fails.
 */
const handleRefundOutcomeEvent = async (event: Stripe.Event, paymentService: StripePaymentService): Promise<void> => {
  const refund = event.data.object as Stripe.Refund;
  if (refund.status !== 'failed' && refund.status !== 'canceled') {
    log.info(`Received: ${event.type} with status ${refund.status} — no commercetools change.`);
    return;
  }
  log.info(`Processing failed refund: ${event.type} (${refund.status})`);
  await paymentService.processStripeEventRefundFailed(event);
};

/** `charge.updated` — multicapture tracking, only when multi-operations is enabled. */
const handleMulticaptureEvent = async (event: Stripe.Event, paymentService: StripePaymentService): Promise<void> => {
  if (!getConfig().stripeEnableMultiOperations) {
    log.info(`Multi-operations disabled, skipping multicapture: ${event.type}`);
    return;
  }
  log.info(`Processing Stripe multicapture event: ${event.type}`);
  await paymentService.processStripeEventMultipleCaptured(event);
};

/**
 * `charge.refunded` — enhanced refund tracking when multi-operations is enabled, basic tracking
 * otherwise. Unlike multicapture, the disabled path still records the refund.
 */
const handleChargeRefundedEvent = async (event: Stripe.Event, paymentService: StripePaymentService): Promise<void> => {
  if (!getConfig().stripeEnableMultiOperations) {
    log.info(`Processing Stripe refund event with basic tracking (multi-operations disabled): ${event.type}`);
    await paymentService.processStripeEvent(event);
    return;
  }
  log.info(`Processing Stripe multirefund event with enhanced tracking: ${event.type}`);
  await paymentService.processStripeEventRefunded(event);
};

export const stripeWebhooksRoutes = async (fastify: FastifyInstance, opts: StripeRoutesOptions) => {
  fastify.post<{ Body: string }>(
    '/stripe/webhooks',
    {
      preHandler: [opts.stripeHeaderAuthHook.authenticate()],
      config: { rawBody: true },
    },
    async (request, reply) => {
      const signature = request.headers['stripe-signature'] as string;

      let event: Stripe.Event;

      try {
        event = await stripeApi().webhooks.constructEvent(
          request.rawBody as string,
          signature,
          getConfig().stripeWebhookSigningSecret,
        );
      } catch (error) {
        const err = error as Error;
        log.error(JSON.stringify(err));
        return reply.status(400).send(`Webhook Error: ${err.message}`);
      }

      switch (event.type) {
        case StripeEvent.CHARGE__CAPTURED:
          log.info(`Received: ${event.type} event of ${event.data.object.id}`);
          break;
        case StripeEvent.PAYMENT_INTENT__REQUIRED_ACTION:
        case StripeEvent.PAYMENT_INTENT__PARTIALLY_FUNDED:
          await handleBankTransferPendingEvent(event, opts.paymentService);
          break;
        case StripeEvent.CUSTOMER_CASH_BALANCE_TRANSACTION__CREATED:
          logCustomerCashBalanceTransaction(event);
          break;
        case StripeEvent.PAYMENT_INTENT__SUCCEEDED:
        case StripeEvent.PAYMENT_INTENT__CANCELED:
        case StripeEvent.PAYMENT_INTENT__PAYMENT_FAILED:
        case StripeEvent.CHARGE__SUCCEEDED:
          if (!isFromSubscriptionInvoice(event)) {
            log.info(`Processing Stripe payment event: ${event.type}`);
            await opts.paymentService.processStripeEvent(event);
          } else if (event.type === StripeEvent.PAYMENT_INTENT__PAYMENT_FAILED) {
            // A subscription-invoice payment_intent.payment_failed AFTER the invoice was paid is an ACH
            // late return (Stripe does not re-fire invoice.payment_failed); flag the payment for review.
            log.info(`Subscription-invoice PI failure — checking for a late ACH return: ${event.type}`);
            await opts.subscriptionService.processSubscriptionEventLateReturn(event);
          }
          // Subscription-invoice charge/PI events are ignored on purpose:
          // invoice.paid / invoice.payment_failed are the single source of truth for
          // subscription payments. Stripe emits charge.succeeded + payment_intent.succeeded +
          // invoice.paid for one subscription charge; routing the charge/PI here would create
          // duplicate CT payments and orders. See processSubscriptionEventPaid / processSubscriptionEventFailed.
          break;
        case StripeEvent.PAYMENT_INTENT__PROCESSING:
          if (!isFromSubscriptionInvoice(event)) {
            log.info(`Processing Stripe payment event: ${event.type}`);
            await opts.paymentService.processStripeEvent(event);
          } else {
            log.info(`payment_intent.processing from subscription invoice — skipped (out of scope): ${event.type}`);
          }
          // Subscription-invoice charge/PI events are ignored on purpose:
          // invoice.paid / invoice.payment_failed are the single source of truth for
          // subscription payments. Stripe emits charge.succeeded + payment_intent.succeeded +
          // invoice.paid for one subscription charge; routing the charge/PI here would create
          // duplicate CT payments and orders. See processSubscriptionEventPaid / processSubscriptionEventFailed.
          break;
        case StripeEvent.CHARGE__UPDATED:
          await handleMulticaptureEvent(event, opts.paymentService);
          break;
        case StripeEvent.CHARGE__REFUNDED:
          await handleChargeRefundedEvent(event, opts.paymentService);
          break;
        case StripeEvent.REFUND__UPDATED:
        case StripeEvent.REFUND__FAILED:
          await handleRefundOutcomeEvent(event, opts.paymentService);
          break;
        case StripeSubscriptionEvent.INVOICE_PAID:
          log.info(`Processing Stripe Subscription event: ${event.type}`);
          await opts.subscriptionService.processSubscriptionEventPaid(event);
          break;
        case StripeSubscriptionEvent.INVOICE_PAYMENT_FAILED:
          log.info(`Processing Stripe Subscription event: ${event.type}`);
          await opts.subscriptionService.processSubscriptionEventFailed(event);
          break;
        case StripeSubscriptionEvent.INVOICE_UPCOMING:
          log.info(`Processing Stripe Subscription event: ${event.type}`);
          await opts.subscriptionService.processSubscriptionEventUpcoming(event);
          break;
        case StripeSubscriptionEvent.CUSTOMER_SUBSCRIPTION_DELETED:
          log.info(`Processing Stripe Subscription event: ${event.type}`);
          await opts.subscriptionService.processSubscriptionEventDeleted(event);
          break;
        default:
          log.info(`--->>> This Stripe event is not supported: ${event.type}`);
          break;
      }

      return reply.status(200).send();
    },
  );
};

export const configElementRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & PaymentRoutesOptions,
) => {
  fastify.get<{ Reply: ConfigElementResponseSchemaDTO; Params: { payment: string } }>(
    '/config-element/:payment',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        params: {
          $id: 'paramsSchema',
          type: 'object',
          properties: {
            payment: Type.String(),
          },
          required: ['payment'],
        },
        response: {
          200: ConfigElementResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { payment } = request.params; // paymentReference
      const resp = await opts.paymentService.initializeCartPayment(payment);

      return reply.status(200).send(resp);
    },
  );
  fastify.get<{ Reply: string }>('/applePayConfig', async (request, reply) => {
    const resp = opts.paymentService.applePayConfig();
    return reply.status(200).send(resp);
  });
};
