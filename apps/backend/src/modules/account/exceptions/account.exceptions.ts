import { BadRequestException, NotFoundException } from '@nestjs/common';

/** Không tìm thấy Account trong Organization (hoặc ngoài phạm vi seller). */
export class AccountNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'ACCOUNT_NOT_FOUND', message: 'Không tìm thấy Account' });
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
