import { randomUUID } from 'node:crypto';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, finalize, tap } from 'rxjs';
@Injectable()
export class RequestLogger implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const supplied = request.headers['x-correlation-id'];
    const correlationId =
      typeof supplied === 'string' && supplied.length <= 128 ? supplied : randomUUID();
    response.setHeader('X-Correlation-Id', correlationId);
    const started = Date.now();
    const data = request.body as
      | {
          walletId?: unknown;
          providerId?: unknown;
        }
      | undefined;
    const walletId = typeof data?.walletId === 'string' ? data.walletId : request.params.walletId;
    const providerId =
      typeof data?.providerId === 'string' ? data.providerId : request.params.providerId;
    let transactionId: string | null = null;
    return next.handle().pipe(
      tap((result: unknown) => {
        if (
          typeof result === 'object' &&
          result &&
          'transactionId' in result &&
          typeof result.transactionId === 'string'
        )
          transactionId = result.transactionId;
      }),
      finalize(() =>
        console.log(
          JSON.stringify({
            level: 'info',
            event: 'http_finished',
            correlationId,
            method: request.method,
            path: request.route?.path ?? request.path,
            statusCode: response.statusCode,
            durationMs: Date.now() - started,
            transactionId,
            walletId: walletId ?? null,
            providerId: providerId ?? null,
            messageId: null,
          }),
        ),
      ),
    );
  }
}
