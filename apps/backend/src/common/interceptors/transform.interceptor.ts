import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../interfaces/api-response.interface';

/**
 * Bọc mọi response thành công vào envelope chuẩn (Mục 12).
 * Áp dụng toàn cục qua APP_INTERCEPTOR.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        code: 'SUCCESS',
        message: '',
        errors: null,
        data: data ?? null,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
