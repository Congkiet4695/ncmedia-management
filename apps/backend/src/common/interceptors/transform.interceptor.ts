import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../interfaces/api-response.interface';

/**
 * Bọc mọi response thành công vào envelope chuẩn (Mục 12).
 * Áp dụng toàn cục qua APP_INTERCEPTOR.
 *
 * Ngoại lệ: file tải xuống (StreamableFile — VD export Excel) trả nguyên vẹn,
 * KHÔNG bọc envelope (nếu không sẽ hỏng file nhị phân).
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | StreamableFile> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | StreamableFile> {
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) return data;
        return {
          success: true,
          code: 'SUCCESS',
          message: '',
          errors: null,
          data: data ?? null,
          timestamp: new Date().toISOString(),
        } satisfies ApiResponse<T>;
      }),
    );
  }
}
