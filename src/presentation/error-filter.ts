import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../domain/errors';
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const err = error as {
      code?: string;
      driverException?: {
        code?: string;
      };
      cause?: {
        code?: string;
      };
    };
    const pgCode = err?.driverException?.code ?? err?.cause?.code ?? err?.code;
    const temporary = [
      '08000',
      '08003',
      '08006',
      '57P01',
      '53300',
      '40001',
      '40P01',
      '28P01',
    ].includes(pgCode ?? '');
    const known = error instanceof DomainError;
    const http = error instanceof HttpException;
    const code = known
      ? error.code
      : http
        ? 'HTTP_VALIDATION_ERROR'
        : temporary
          ? 'INFRASTRUCTURE_UNAVAILABLE'
          : 'INTERNAL_ERROR';
    const msg = known
      ? error.message
      : http
        ? error.message
        : temporary
          ? 'Banco temporariamente indisponível. Tente novamente.'
          : 'Erro interno não detalhado.';
    const status = known
      ? error.httpStatus
      : http
        ? error.getStatus()
        : temporary
          ? HttpStatus.SERVICE_UNAVAILABLE
          : HttpStatus.INTERNAL_SERVER_ERROR;
    if (!known && !http)
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'request_failed',
          name: error instanceof Error ? error.name : 'unknown',
          pgCode,
          path: request.url,
        }),
      );
    response.status(status).json({ code, message: msg, statusCode: status, path: request.url });
  }
}
