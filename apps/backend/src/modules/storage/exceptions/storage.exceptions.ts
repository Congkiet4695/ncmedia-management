import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { STORAGE_ERROR_CODES } from '../storage.constants';

/** Phân loại sự cố phía nhà cung cấp lưu trữ — quyết định cách xử lý/thông báo. */
export enum StorageProviderErrorKind {
  /** Hết thời gian chờ / lỗi mạng — có thể thử lại. */
  TIMEOUT = 'TIMEOUT',
  /** Sai Access Key/Secret hoặc không đủ quyền — lỗi cấu hình, KHÔNG thử lại. */
  UNAUTHORIZED = 'UNAUTHORIZED',
  /** Bucket không tồn tại — lỗi cấu hình. */
  BUCKET_NOT_FOUND = 'BUCKET_NOT_FOUND',
  /** Object không tồn tại. */
  OBJECT_NOT_FOUND = 'OBJECT_NOT_FOUND',
  /** Lỗi khác của nhà cung cấp. */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Lỗi thô từ tầng provider — mang đủ ngữ cảnh kỹ thuật để LOG.
 * `StorageService` dịch sang exception nghiệp vụ trước khi trả ra API.
 */
export class StorageProviderException extends Error {
  constructor(
    readonly kind: StorageProviderErrorKind,
    readonly operation: 'put' | 'get' | 'delete' | 'exists',
    message: string,
    readonly objectKey?: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageProviderException';
  }
}

// ---------------------------------------------------------------------------
// Exception nghiệp vụ (trả ra API)
// ---------------------------------------------------------------------------

export class StorageFileMissingException extends BadRequestException {
  constructor() {
    super({
      code: STORAGE_ERROR_CODES.FILE_MISSING,
      message: 'Chưa chọn file để tải lên',
    });
  }
}

export class StorageFileEmptyException extends BadRequestException {
  constructor(fileName?: string) {
    super({
      code: STORAGE_ERROR_CODES.FILE_EMPTY,
      message: fileName ? `File "${fileName}" rỗng (0 byte)` : 'File rỗng (0 byte)',
    });
  }
}

export class StorageFileTooLargeException extends PayloadTooLargeException {
  constructor(limitBytes: number, fileName?: string) {
    const limitMb = Math.round(limitBytes / (1024 * 1024));
    super({
      code: STORAGE_ERROR_CODES.FILE_TOO_LARGE,
      message: fileName
        ? `File "${fileName}" vượt quá giới hạn ${limitMb}MB`
        : `File vượt quá giới hạn ${limitMb}MB`,
    });
  }
}

export class StorageUnsupportedTypeException extends UnprocessableEntityException {
  constructor(allowed: readonly string[], fileName?: string) {
    super({
      code: STORAGE_ERROR_CODES.UNSUPPORTED_TYPE,
      message: `${fileName ? `File "${fileName}": ` : ''}định dạng không được hỗ trợ. Cho phép: ${allowed.join(', ')}`,
    });
  }
}

/** Đuôi file nằm trong danh sách cấm (thực thi / kịch bản). */
export class StorageExtensionBlockedException extends UnprocessableEntityException {
  constructor(extension: string) {
    super({
      code: STORAGE_ERROR_CODES.EXTENSION_BLOCKED,
      message: `Không cho phép tải lên file ".${extension}" vì lý do bảo mật`,
    });
  }
}

/** Mime type và phần mở rộng không khớp nhau — dấu hiệu file bị đổi đuôi. */
export class StorageMimeExtensionMismatchException extends UnprocessableEntityException {
  constructor(mimeType: string, extension: string) {
    super({
      code: STORAGE_ERROR_CODES.MIME_EXTENSION_MISMATCH,
      message: `Loại nội dung (${mimeType}) không khớp phần mở rộng ".${extension}"`,
    });
  }
}

export class StorageFileNotFoundException extends NotFoundException {
  constructor() {
    super({ code: STORAGE_ERROR_CODES.NOT_FOUND, message: 'Không tìm thấy file' });
  }
}

/** File đang được module nghiệp vụ tham chiếu — không cho xoá trực tiếp. */
export class StorageFileInUseException extends ConflictException {
  constructor() {
    super({
      code: STORAGE_ERROR_CODES.IN_USE,
      message:
        'File đang được sử dụng bởi một bản ghi nghiệp vụ. ' +
        'Hãy xoá ở màn hình nghiệp vụ tương ứng thay vì xoá trực tiếp.',
    });
  }
}

export class StorageUploadFailedException extends BadGatewayException {
  constructor(message = 'Tải file lên kho lưu trữ thất bại. Vui lòng thử lại.') {
    super({ code: STORAGE_ERROR_CODES.UPLOAD_FAILED, message });
  }
}

export class StorageDeleteFailedException extends BadGatewayException {
  constructor() {
    super({
      code: STORAGE_ERROR_CODES.DELETE_FAILED,
      message: 'Xoá file khỏi kho lưu trữ thất bại. Vui lòng thử lại.',
    });
  }
}

export class StorageDownloadFailedException extends BadGatewayException {
  constructor() {
    super({
      code: STORAGE_ERROR_CODES.DOWNLOAD_FAILED,
      message: 'Tải file từ kho lưu trữ thất bại. Vui lòng thử lại.',
    });
  }
}

export class StorageProviderTimeoutException extends GatewayTimeoutException {
  constructor() {
    super({
      code: STORAGE_ERROR_CODES.PROVIDER_TIMEOUT,
      message: 'Kho lưu trữ phản hồi quá chậm. Vui lòng thử lại.',
    });
  }
}

/** Sai credential hoặc bucket không tồn tại — lỗi cấu hình hệ thống, không phải lỗi người dùng. */
export class StorageProviderMisconfiguredException extends BadGatewayException {
  constructor(kind: StorageProviderErrorKind) {
    const isBucket = kind === StorageProviderErrorKind.BUCKET_NOT_FOUND;
    super({
      code: isBucket
        ? STORAGE_ERROR_CODES.BUCKET_NOT_FOUND
        : STORAGE_ERROR_CODES.PROVIDER_UNAUTHORIZED,
      message: isBucket
        ? 'Bucket lưu trữ không tồn tại. Vui lòng kiểm tra cấu hình hệ thống.'
        : 'Thông tin xác thực kho lưu trữ không hợp lệ. Vui lòng kiểm tra cấu hình hệ thống.',
    });
  }
}

export class StorageObjectNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: STORAGE_ERROR_CODES.OBJECT_NOT_FOUND,
      message: 'File không còn tồn tại trên kho lưu trữ',
    });
  }
}
