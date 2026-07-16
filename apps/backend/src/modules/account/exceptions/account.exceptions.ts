import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** Không tìm thấy Account trong Organization (hoặc ngoài phạm vi seller). */
export class AccountNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'ACCOUNT_NOT_FOUND', message: 'Không tìm thấy Account' });
  }
}

/** Trùng ID_Normalize trong Organization (BR-A04). */
export class AccountDuplicateException extends ConflictException {
  constructor() {
    super({ code: 'ACCOUNT_DUPLICATE', message: 'ID chuẩn hoá đã tồn tại trong tổ chức' });
  }
}

/** Platform không hợp lệ. */
export class PlatformInvalidException extends BadRequestException {
  constructor() {
    super({ code: 'PLATFORM_INVALID', message: 'Platform không hợp lệ' });
  }
}

/** Seller không hợp lệ (không thuộc Organization). */
export class SellerInvalidException extends BadRequestException {
  constructor() {
    super({ code: 'SELLER_INVALID', message: 'Seller không hợp lệ trong tổ chức' });
  }
}
