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

import { SupportedPaymentComponentsSchemaDTO } from '../dtos/operations/payment-componets.dto';

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
      //requestAmount = request.amount; get the amount from the request to make partial modifications to the payment
      requestAmount = ctPayment.amountPlanned; // MVP capture/refund the total of the order
    } else {
      requestAmount = ctPayment.amountPlanned;
    }

    const transactionType = this.getPaymentTransactionType(request.action);

    const updatedPayment = await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      transaction: {
        type: transactionType,
        amount: requestAmount,
        state: 'Initial',
      },
    });

    const res = await this.processPaymentModification(updatedPayment, transactionType, requestAmount);

    await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      transaction: {
        type: transactionType,
        amount: requestAmount,
        interactionId: res.pspReference,
        state: res.outcome === PaymentModificationStatus.APPROVED ? 'Success' : 'Failure',
      },
    });

    return {
      outcome: res.outcome,
    };
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
      // TODO: Handle Error case
      default: {
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
