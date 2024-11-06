import { Errorx, ErrorxAdditionalOpts } from '@commercetools/connect-payments-sdk';

export type StripeApiErrorData = {
  code: string;
  doc_url: string;
  message: string;
  param: string;
  request_log_url: string;
  type: string;
  statusCode: number;
  requestId: string;
};

export class StripeApiError extends Errorx {
  constructor(errorData: StripeApiErrorData, additionalOpts?: ErrorxAdditionalOpts) {
    super({
      code: errorData.code,
      httpErrorStatus: errorData.statusCode,
      message: errorData.message,
      ...additionalOpts,
    });
  }
}
