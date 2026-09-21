import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { Request, Response } from 'express';
import { ApiErrorItem, ApiResponse } from '../interfaces/api-response.interface';

/**
 * Global Exception Filter — chuẩn hóa mọi lỗi thành envelope thống nhất
 * (CLAUDE.md Mục 12/14, ADR-022). Không rò rỉ stack trace ở production.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let errors: ApiErrorItem[] | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      code = this.defaultCodeFor(status);

      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const body = res as Record<string, unknown>;
        if (typeof body.code === 'string') code = body.code;
        if (typeof body.message === 'string') message = body.message;
        else if (Array.isArray(body.message)) message = (body.message as string[]).join(', ');
        if (Array.isArray(body.errors)) errors = body.errors as ApiErrorItem[];
      }
    } else if (isHttpLibraryError(exception)) {
      // Lỗi do tầng HTTP của Express ném ra TRƯỚC khi tới controller (body-parser: body quá
      // 100 KB ⇒ 413 `entity.too.large`, JSON hỏng ⇒ 400…). Chúng không phải `HttpException`
      // của Nest nhưng mang `status` chuẩn `http-errors` — báo đúng mã thay vì 500 INTERNAL_ERROR
      // ("Batch edit 3.107 SKU ⇒ Internal server error" chính là ca này).
      status = exception.status;
      code = this.defaultCodeFor(status);
      message = exception.expose === false ? this.defaultMessageFor(status) : exception.message;
    } else if (exception instanceof Error) {
      message =
        process.env.NODE_ENV === 'production' ? 'Internal server error' : exception.message;
    }

    // Log: 5xx là error, 4xx là warn
    const logPayload = { statusCode: status, path: request.url, method: request.method };
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(logPayload, exception instanceof Error ? exception.stack : 'Unknown error');
    } else {
      this.logger.warn(logPayload, message);
    }

    const payload: ApiResponse<null> = {
      success: false,
      code,
      message,
      errors,
      data: null,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(payload);
  }

  private defaultMessageFor(status: number): string {
    const payloadTooLarge: number = HttpStatus.PAYLOAD_TOO_LARGE;
    return status === payloadTooLarge ? 'Request body too large' : 'Request error';
  }

  private defaultCodeFor(status: number): string {
    const map: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      // Vượt giới hạn dung lượng upload (VD import Excel > 10MB).
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
  }
}

/** Lỗi kiểu `http-errors` (body-parser, raw-body…): `Error` có `status` 4xx/5xx hợp lệ. */
function isHttpLibraryError(
  exception: unknown,
): exception is Error & { status: number; expose?: boolean; type?: string } {
  if (!(exception instanceof Error)) return false;
  const status = (exception as { status?: unknown }).status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 600;
}
