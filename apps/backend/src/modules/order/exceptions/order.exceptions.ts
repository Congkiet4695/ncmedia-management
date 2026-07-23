import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/** Không tìm thấy Order trong Organization (hoặc ngoài phạm vi seller — row-level). */
export class OrderNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy Order' });
  }
}

/** Trùng Order Number trong cùng (Organization, Platform). */
export class OrderDuplicateException extends ConflictException {
  constructor() {
    super({ code: 'ORDER_DUPLICATE', message: 'Order Number đã tồn tại trong nền tảng này' });
  }
}

/** Account không hợp lệ (không thuộc Organization). */
export class OrderAccountInvalidException extends BadRequestException {
  constructor() {
    super({ code: 'ORDER_ACCOUNT_INVALID', message: 'Account không hợp lệ trong tổ chức' });
  }
}

/** Seller cố thao tác Order trên Account không do mình quản lý (BR row-level). */
export class OrderAccountForbiddenException extends ForbiddenException {
  constructor() {
    super({
      code: 'ORDER_ACCOUNT_FORBIDDEN',
      message: 'Bạn chỉ được thao tác Order thuộc Account mình quản lý',
    });
  }
}

/** Order phải có ít nhất 1 sản phẩm (OrderItem). */
export class OrderItemsRequiredException extends BadRequestException {
  constructor() {
    super({ code: 'ORDER_ITEMS_REQUIRED', message: 'Đơn hàng phải có ít nhất 1 sản phẩm' });
  }
}

/**
 * Order đang được Fulfillment khác xử lý (đã claim) — khoá chỉnh sửa (Requirement 3/14).
 * 409 CONFLICT. Backend luôn kiểm tra (không chỉ Frontend).
 */
export class OrderLockedException extends ConflictException {
  constructor(fulfillerName?: string | null) {
    super({
      code: 'ORDER_LOCKED',
      message: fulfillerName
        ? `Đơn hàng đang được xử lý bởi Fulfillment khác (${fulfillerName}).`
        : 'Đơn hàng đang được xử lý bởi Fulfillment khác.',
    });
  }
}

/** Fulfillment chưa "Nhận xử lý" (claim) đơn — không được thao tác fulfillment. 409. */
export class OrderNotClaimedException extends ConflictException {
  constructor() {
    super({
      code: 'ORDER_NOT_CLAIMED',
      message: 'Bạn cần "Nhận xử lý" đơn hàng trước khi cập nhật.',
    });
  }
}

/** Không tìm thấy OrderNote (hoặc không thuộc Order). */
export class OrderNoteNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'ORDER_NOTE_NOT_FOUND', message: 'Không tìm thấy ghi chú của đơn hàng' });
  }
}

/** Không tìm thấy OrderItem (hoặc không thuộc Order). */
export class OrderItemNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'ORDER_ITEM_NOT_FOUND', message: 'Không tìm thấy sản phẩm trong đơn hàng' });
  }
}
