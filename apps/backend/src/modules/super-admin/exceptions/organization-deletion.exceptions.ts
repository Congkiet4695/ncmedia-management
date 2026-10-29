import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { ApiErrorItem } from '../../../common/interfaces/api-response.interface';

/** Slug xác nhận không khớp Organization cần xoá. */
export class OrganizationDeleteConfirmationMismatchException extends BadRequestException {
  constructor() {
    super({
      code: 'PLATFORM_ORGANIZATION_DELETE_CONFIRMATION_MISMATCH',
      message: 'Slug xác nhận không khớp Organization cần xoá — không có dữ liệu nào bị xoá.',
    });
  }
}

/** Một lượt xoá khác đang chạy cho chính Organization này. */
export class OrganizationDeleteBusyException extends ConflictException {
  constructor() {
    super({
      code: 'PLATFORM_ORGANIZATION_DELETE_BUSY',
      message: 'Organization này đang được xoá ở một yêu cầu khác — vui lòng chờ.',
    });
  }
}

/**
 * Không xác định được an toàn toàn bộ dữ liệu phụ thuộc ⇒ TỪ CHỐI, không xoá gì.
 *
 * `errors` chỉ chứa tên bảng / quan hệ (`field`) và lý do — không chứa dữ liệu nghiệp vụ.
 */
export class OrganizationDeleteUnsafeException extends ConflictException {
  constructor(errors: ApiErrorItem[]) {
    super({
      code: 'PLATFORM_ORGANIZATION_DELETE_UNSAFE',
      message:
        'Không thể xác định an toàn toàn bộ dữ liệu phụ thuộc của Organization — đã từ chối, không có dữ liệu nào bị xoá.',
      errors,
    });
  }
}

/** Lỗi giữa chừng ⇒ transaction đã ROLLBACK, không có dữ liệu nào bị xoá. */
export class OrganizationDeleteFailedException extends InternalServerErrorException {
  constructor() {
    super({
      code: 'PLATFORM_ORGANIZATION_DELETE_FAILED',
      message:
        'Xoá Organization thất bại và đã được hoàn tác toàn bộ — không có dữ liệu nào bị xoá.',
    });
  }
}
