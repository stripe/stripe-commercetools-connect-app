import { FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';

import { FastifySchemaValidationError } from 'fastify/types/schema';
import { log } from '../logger';
import { redactError } from '../../utils';
import {
  ErrorAuthErrorResponse,
  ErrorGeneral,
  ErrorInvalidField,
  ErrorInvalidJsonInput,
  ErrorRequiredField,
  Errorx,
  MultiErrorx,
} from '@commercetools/connect-payments-sdk';
import { TAuthErrorResponse, TErrorObject, TErrorResponse } from './dtos/error.dto';

function isFastifyValidationError(error: Error): error is FastifyError {
  return (error as unknown as FastifyError).validation != undefined;
}

export const errorHandler = (error: Error, req: FastifyRequest, reply: FastifyReply) => {
  if (isFastifyValidationError(error) && error.validation) {
    return handleErrors(transformValidationErrors(error.validation, req), reply);
  } else if (error instanceof ErrorAuthErrorResponse) {
    return handleAuthError(error, reply);
  } else if (error instanceof Errorx) {
    return handleErrors([error], reply);
  } else if (error instanceof MultiErrorx) {
    return handleErrors(error.errors, reply);
  }

  // If it isn't any of the cases above (for example a normal Error is thrown) then fallback to a general 500 internal server error
  return handleErrors([new ErrorGeneral('Internal server error.', { cause: error, skipLog: false })], reply);
};

const handleAuthError = (error: ErrorAuthErrorResponse, reply: FastifyReply) => {
  const transformedErrors: TErrorObject[] = transformErrorxToHTTPModel([error]);

  const response: TAuthErrorResponse = {
    message: error.message,
    statusCode: error.httpErrorStatus,
    errors: transformedErrors,
    error: transformedErrors[0].code,
    error_description: transformedErrors[0].message,
  };

  return reply.code(error.httpErrorStatus).send(response);
};

const handleErrors = (errorxList: Errorx[], reply: FastifyReply) => {
  const transformedErrors: TErrorObject[] = transformErrorxToHTTPModel(errorxList);

  // Based on CoCo specs, the root level message attribute is always set to the values from the first error. MultiErrorx enforces the same HTTP status code.
  const response: TErrorResponse = {
    message: errorxList[0].message,
    statusCode: errorxList[0].httpErrorStatus,
    errors: transformedErrors,
  };

  return reply.code(errorxList[0].httpErrorStatus).send(response);
};

const transformErrorxToHTTPModel = (errors: Errorx[]): TErrorObject[] => {
  const errorObjectList: TErrorObject[] = [];

  for (const err of errors) {
    if (err.skipLog) {
      log.debug(err.message, redactError(err));
    } else {
      log.error(err.message, redactError(err));
    }

    const tErrObj: TErrorObject = {
      code: err.code,
      message: err.message,
      ...(err.fields ? err.fields : {}), // Add any additional field to the response object (which will differ per type of error)
    };

    errorObjectList.push(tErrObj);
  }

  return errorObjectList;
};

const transformValidationErrors = (errors: FastifySchemaValidationError[], req: FastifyRequest): Errorx[] => {
  const errorxList: Errorx[] = [];

  for (const err of errors) {
    switch (err.keyword) {
      case 'required':
        errorxList.push(new ErrorRequiredField(err.params.missingProperty as string));
        break;
      case 'enum':
        errorxList.push(
          new ErrorInvalidField(
            getKeys(err.instancePath).join('.'),
            getPropertyFromPath(err.instancePath, req.body),
            err.params.allowedValues as string,
          ),
        );
        break;
    }
  }

  // If we cannot map the validation error to a CoCo error then return a general InvalidJsonError
  if (errorxList.length === 0) {
    errorxList.push(new ErrorInvalidJsonInput());
  }

  return errorxList;
};

const getKeys = (path: string) => path.replace(/^\//, '').split('/');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getPropertyFromPath = (path: string, obj: any): any => {
  const keys = getKeys(path);
  let value = obj;
  for (const key of keys) {
    value = value[key];
  }
  return value;
};
