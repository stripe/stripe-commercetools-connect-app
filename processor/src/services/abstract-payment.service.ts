import {
  CommercetoolsCartService,
  CommercetoolsPaymentService,
  ErrorInvalidJsonInput,
  ErrorInvalidOperation,
  Payment,
} from '@commercetools/connect-payments-sdk';
import {
  CancelPaymentRequest,
  CapturePaymentRequest,
  ConfigResponse,
  ModifyPayment,
  PaymentProviderModificationResponse,
  RefundPaymentRequest,
  StatusResponse,
} from './types/operation.type';
import {
  AmountSchemaDTO,
  PaymentIntentResponseSchemaDTO,
  PaymentModificationStatus,
  PaymentTransactions,
} from '../dtos/operations/payment-intents.dto';
import { log } from '../libs/logger';

import { SupportedPaymentComponentsSchemaDTO } from '../dtos/operations/payment-componets.dto';
import { TransactionDraftDTO, TransactionResponseDTO } from '../dtos/operations/transaction.dto';

export abstract class AbstractPaymentService {
  protected ctCartService: CommercetoolsCartService;
  protected ctPaymentService: CommercetoolsPaymentService;

  protected constructor(ctCartService: CommercetoolsCartService, ctPaymentService: CommercetoolsPaymentService) {
    this.ctCartService = ctCartService;
    this.ctPaymentService = ctPaymentService;
  }

  /**
   * Get configurations
   *
   * @remarks
   * Abstract method to get configuration information
   *
   * @returns Promise with object containing configuration information
   */
  abstract config(): Promise<ConfigResponse>;

  /**
   * Get status
   *
   * @remarks
   * Abstract method to get status of external systems
   *
   * @returns Promise with a list of status from different external systems
   */
  abstract status(): Promise<StatusResponse>;

  /**
   * Get supported payment components
   *
   * @remarks
   * Abstract method to fetch the supported payment components by the processor. The actual invocation should be implemented in subclasses
   *
   * @returns Promise with a list of supported payment components
   */
  abstract getSupportedPaymentComponents(): Promise<SupportedPaymentComponentsSchemaDTO>;

  /**
   * Capture payment
   *
   * @remarks
   * Abstract method to execute payment capture in external PSPs. The actual invocation to PSPs should be implemented in subclasses
   *
   * @param request - contains the amount and {@link https://docs.commercetools.com/api/projects/payments | Payment } defined in composable commerce
   * @returns Promise with the outcome containing operation status and PSP reference
   */
  abstract capturePayment(request: CapturePaymentRequest): Promise<PaymentProviderModificationResponse>;

  /**
   * Cancel payment
   *
   * @remarks
   * Abstract method to execute payment cancel in external PSPs. The actual invocation to PSPs should be implemented in subclasses
   *
   * @param request - contains {@link https://docs.commercetools.com/api/projects/payments | Payment } defined in composable commerce
   * @returns Promise with outcome containing operation status and PSP reference
   */
  abstract cancelPayment(request: CancelPaymentRequest): Promise<PaymentProviderModificationResponse>;

  /**
   * Refund payment
   *
   * @remarks
   * Abstract method to execute payment refund in external PSPs. The actual invocation to PSPs should be implemented in subclasses
   *
   * @param request
   * @returns Promise with outcome containing operation status and PSP reference
   */
  abstract refundPayment(request: RefundPaymentRequest): Promise<PaymentProviderModificationResponse>;

  /**
   * Handle the payment transaction request. It will create a new Payment in CoCo and associate it with the provided cartId. If no amount is given it will use the full cart amount.
   *
   * @remarks
   * Abstract method to handle payment transaction requests. The actual invocation to PSPs should be implemented in subclasses
   *
   * @param transactionDraft the incoming request payload
   * @returns Promise with the created Payment and whether or not it was a success or not
   */
  abstract handleTransaction(transactionDraft: TransactionDraftDTO): Promise<TransactionResponseDTO>;

  /**
   * Modify payment
   *
   * @remarks
   * This method is used to execute Capture/Cancel/Refund payment in external PSPs and update composable commerce. The actual invocation to PSPs should be implemented in subclasses
   * MVP - capture/refund the total of the order
   *
   * @param opts - input for payment modification including payment ID, action and payment amount
   * @returns Promise with outcome of payment modification after invocation to PSPs
   */
  public async modifyPayment(opts: ModifyPayment): Promise<PaymentIntentResponseSchemaDTO> {
    const ctPayment = await this.ctPaymentService.getPayment({
      id: opts.paymentId,
    });
    const request = opts.data.actions[0];

    let requestAmount!: AmountSchemaDTO;
    if (request.action != 'cancelPayment') {
      requestAmount = request.amount;
    } else {
      requestAmount = ctPayment.amountPlanned;
    }
    // MVP capture/refund the total of the order
    // To perform a partial capture or refund, retrieve the specific amount from 'request.amount'.
    // requestAmount = request.amount;

    const transactionType = this.getPaymentTransactionType(request.action);

    const updatedPayment = await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      transaction: {
        type: transactionType,
        amount: requestAmount,
        state: 'Initial',
      },
    });

    log.info(`Processing payment modification.`, {
      paymentId: updatedPayment.id,
      action: request.action,
    });

    const res = await this.processPaymentModification(updatedPayment, transactionType, requestAmount);

    await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      transaction: {
        type: transactionType,
        amount: requestAmount,
        interactionId: res.pspReference,
        state: this.convertPaymentModificationOutcomeToState(res.outcome),
      },
    });

    log.info(`Payment modification completed.`, {
      paymentId: updatedPayment.id,
      action: request.action,
      result: res.outcome,
    });

    return {
      outcome: res.outcome,
    };
  }

  protected convertPaymentModificationOutcomeToState(
    outcome: PaymentModificationStatus,
  ): 'Pending' | 'Success' | 'Failure' {
    if (outcome === PaymentModificationStatus.RECEIVED) {
      return 'Pending';
    } else if (outcome === PaymentModificationStatus.APPROVED) {
      return 'Success';
    } else {
      return 'Failure';
    }
  }

  protected getPaymentTransactionType(action: string): string {
    switch (action) {
      case 'cancelPayment': {
        return PaymentTransactions.CANCEL_AUTHORIZATION;
      }
      case 'capturePayment': {
        return PaymentTransactions.CHARGE;
      }
      case 'refundPayment': {
        return PaymentTransactions.REFUND;
      }
      default: {
        log.error(`Operation ${action} not supported when modifying payment.`);
        throw new ErrorInvalidJsonInput(`Request body does not contain valid JSON.`);
      }
    }
  }

  protected async processPaymentModification(
    payment: Payment,
    transactionType: string,
    requestAmount: AmountSchemaDTO,
  ) {
    switch (transactionType) {
      case PaymentTransactions.CANCEL_AUTHORIZATION: {
        return await this.cancelPayment({ payment });
      }
      case PaymentTransactions.CHARGE: {
        return await this.capturePayment({ amount: requestAmount, payment });
      }
      case PaymentTransactions.REFUND: {
        return await this.refundPayment({ amount: requestAmount, payment });
      }
      default: {
        throw new ErrorInvalidOperation(`Operation ${transactionType} not supported.`);
      }
    }
  }
}
