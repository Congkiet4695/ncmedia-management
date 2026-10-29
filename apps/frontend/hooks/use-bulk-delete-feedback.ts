'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslateErrorCode } from '@/hooks/use-api-error';
import type { BulkDeleteResult } from '@/types/api';

/** Số dòng lỗi liệt kê trong thông báo; phần còn lại người dùng xem lại trên danh sách. */
const LISTED_FAILURES = 5;

interface BulkDeleteFeedbackOptions {
  /** Tên hiển thị của một id (để dòng lỗi đọc được). */
  nameOf: (id: string) => string;
  /** Thông báo khi MỌI dòng đã xoá. */
  success: (deleted: number) => string;
  /** Tiêu đề khi chỉ xoá được một phần. */
  partial: (deleted: number, failed: number) => string;
}

/**
 * Báo kết quả xoá hàng loạt THEO TỪNG DÒNG: xoá hết ⇒ thành công; xoá một phần ⇒ cảnh báo kèm dòng nào
 * hỏng và vì sao (mã lỗi được dịch). Không bao giờ báo "xong" chung khi có dòng hỏng.
 */
export function useBulkDeleteFeedback() {
  const translateErrorCode = useTranslateErrorCode();

  return useCallback(
    (result: BulkDeleteResult, options: BulkDeleteFeedbackOptions): void => {
      if (result.failed.length === 0) {
        toast.success(options.success(result.deleted.length));
        return;
      }
      toast.warning(options.partial(result.deleted.length, result.failed.length), {
        description: result.failed
          .slice(0, LISTED_FAILURES)
          .map(
            (failure) =>
              `${options.nameOf(failure.id)}: ${translateErrorCode(failure.code, failure.message)}`,
          )
          .join('\n'),
      });
    },
    [translateErrorCode],
  );
}
