import { BadGatewayException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PodFlashSaleStatus } from '@prisma/client';

/**
 * Exception nghiệp vụ của module Flash Sale.
 *
 * 🔴 Cùng khuôn với `pod-tiktok.exceptions.ts`: mỗi lỗi có `code` ổn định (frontend dịch
 * sang thông điệp bản địa) + `message` tiếng Việt cho người đọc log và Swagger. Không nơi
 * nào trong module được `throw new BadRequestException('chuỗi')` — mã lỗi rải rác là thứ
 * khiến frontend phải so khớp chuỗi để biết chuyện gì xảy ra.
 */

export class PodFlashSaleNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_FLASH_SALE_NOT_FOUND', message: 'Không tìm thấy Flash Sale' });
  }
}

export class PodFlashSaleItemNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'POD_FLASH_SALE_ITEM_NOT_FOUND',
      message: 'Không tìm thấy sản phẩm trong Flash Sale này',
    });
  }
}

export class PodFlashSaleTemplateNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'POD_FLASH_SALE_TEMPLATE_NOT_FOUND',
      message: 'Không tìm thấy Flash Sale Template',
    });
  }
}

/** Tên đợt sale / template đã tồn tại (TikTok yêu cầu `title` duy nhất trong shop). */
export class PodFlashSaleNameTakenException extends ConflictException {
  constructor(scope: 'SHOP' | 'ORGANIZATION') {
    super({
      code: 'POD_FLASH_SALE_NAME_TAKEN',
      message:
        scope === 'SHOP'
          ? 'Tên Flash Sale đã tồn tại trong shop này. TikTok yêu cầu tên hoạt động duy nhất.'
          : 'Tên Template đã tồn tại trong tổ chức này.',
    });
  }
}

/**
 * Thao tác không hợp lệ với trạng thái hiện tại (sửa một đợt đang chạy, publish một đợt đã
 * kết thúc…).
 *
 * 🔴 Nói rõ trạng thái hiện tại trong `message`: "không thể sửa" mà không cho biết vì sao
 * là thứ khiến người vận hành bấm lại năm lần rồi mới đi hỏi.
 */
export class PodFlashSaleInvalidStateException extends ConflictException {
  constructor(action: string, current: PodFlashSaleStatus) {
    super({
      code: 'POD_FLASH_SALE_INVALID_STATE',
      message: `Không thể ${action} khi Flash Sale đang ở trạng thái ${current}.`,
    });
  }
}

/** Dữ liệu chưa đạt để publish — kèm danh sách lý do đọc được. */
export class PodFlashSaleNotPublishableException extends BadRequestException {
  constructor(issues: Array<{ code: string; field: string; message: string }>) {
    super({
      code: 'POD_FLASH_SALE_NOT_PUBLISHABLE',
      message: 'Flash Sale chưa đủ điều kiện đẩy lên sàn.',
      details: issues,
    });
  }
}

/** Sản phẩm được chọn không thuộc shop của đợt sale. */
export class PodFlashSaleProductMismatchException extends BadRequestException {
  constructor() {
    super({
      code: 'POD_FLASH_SALE_PRODUCT_MISMATCH',
      message:
        'Sản phẩm được chọn không thuộc shop của Flash Sale này. Một đợt Flash Sale chỉ ' +
        'chạy trên đúng một shop.',
    });
  }
}

/** Vượt trần số dòng của một đợt (hoặc của một lần thao tác). */
export class PodFlashSaleTooManyItemsException extends BadRequestException {
  constructor(max: number) {
    super({
      code: 'POD_FLASH_SALE_TOO_MANY_ITEMS',
      // 🔴 KHÔNG nói "giới hạn của TikTok": TikTok giới hạn 300 mục cho mỗi REQUEST, không
      // giới hạn tổng số SKU của một khuyến mãi. Đây là trần của hệ thống.
      message: `Một Flash Sale chỉ chứa tối đa ${max} dòng sản phẩm.`,
    });
  }
}

/** Không lấy được ngữ cảnh gọi API của shop (token hỏng, shop đã bị gỡ). */
export class PodFlashSaleShopContextException extends BadRequestException {
  constructor(message: string) {
    super({ code: 'POD_FLASH_SALE_SHOP_CONTEXT', message });
  }
}

/**
 * TikTok từ chối lời gọi.
 *
 * `BadGateway` chứ không phải `BadRequest`: từ góc nhìn của người dùng hệ thống, request
 * của họ hợp lệ — mắt xích hỏng nằm ở nhà cung cấp phía sau. Mã lỗi + `request_id` của
 * TikTok đi kèm để mở ticket.
 */
export class PodFlashSaleProviderException extends BadGatewayException {
  constructor(providerCode: string | null, providerMessage: string, requestId?: string) {
    super({
      code: 'POD_FLASH_SALE_PROVIDER_ERROR',
      message: `TikTok từ chối yêu cầu Flash Sale: ${providerMessage}`,
      details: { providerCode, requestId: requestId ?? null },
    });
  }
}

/** Cấu hình template lưu trong JSON không đúng hình dạng. */
/**
 * Hoạt động trên TikTok không còn sửa được (TikTok: không cập nhật sản phẩm của hoạt động
 * `DEACTIVATED`/`EXPIRED`; hoặc `activity_commands` chứa `IMMUTABLE`). Chặn TRƯỚC khi gửi.
 */
export class PodFlashSaleNotEditableOnProviderException extends ConflictException {
  constructor(providerStatus: string | null, immutable: boolean) {
    super({
      code: 'POD_FLASH_SALE_NOT_EDITABLE_ON_PROVIDER',
      message: immutable
        ? 'TikTok đã khoá hoạt động khuyến mãi này (IMMUTABLE) — không thêm được sản phẩm.'
        : `Hoạt động trên TikTok đang ở trạng thái ${providerStatus ?? 'không rõ'} — TikTok không cho cập nhật sản phẩm.`,
    });
  }
}

export class PodFlashSaleTemplateConfigInvalidException extends BadRequestException {
  constructor(reason: string) {
    super({
      code: 'POD_FLASH_SALE_TEMPLATE_CONFIG_INVALID',
      message: `Cấu hình template không hợp lệ: ${reason}`,
    });
  }
}

/** Shop đang có một lượt đồng bộ Flash Sale khác chạy (khoá theo shop). */
export class PodFlashSaleImportBusyException extends ConflictException {
  constructor() {
    super({
      code: 'POD_FLASH_SALE_IMPORT_BUSY',
      message: 'Shop này đang được đồng bộ Flash Sale từ TikTok — vui lòng thử lại sau ít phút.',
    });
  }
}

/** Một lượt Auto Flash Sale khác của tổ chức đang chạy (cron hoặc Run Now). */
export class PodFlashSaleAutoBusyException extends ConflictException {
  constructor() {
    super({
      code: 'POD_FLASH_SALE_AUTO_BUSY',
      message: 'Đang có một lượt Auto Flash Sale chạy cho tổ chức này — vui lòng thử lại sau ít phút.',
    });
  }
}

/** Bật Auto ở một đợt đã sinh ra đợt kế tiếp — phải bật ở đợt cuối chuỗi. */
export class PodFlashSaleAutoHasNextException extends ConflictException {
  constructor(nextName: string) {
    super({
      code: 'POD_FLASH_SALE_AUTO_HAS_NEXT',
      message: `Đợt này đã có đợt kế tiếp "${nextName}" trong chuỗi Auto — hãy bật Auto ở đợt cuối chuỗi.`,
    });
  }
}

/** Chuỗi đã có một đợt khác đang bật Auto. */
export class PodFlashSaleAutoChainActiveException extends ConflictException {
  constructor() {
    super({
      code: 'POD_FLASH_SALE_AUTO_CHAIN_ACTIVE',
      message: 'Chuỗi Auto này đã có một đợt khác đang bật Auto — mỗi chuỗi chỉ có một đợt bật Auto.',
    });
  }
}

/** Cấu hình lịch Auto không hợp lệ (múi giờ không phải IANA …). */
export class PodFlashSaleAutoConfigInvalidException extends BadRequestException {
  constructor(message: string) {
    super({ code: 'POD_FLASH_SALE_AUTO_CONFIG_INVALID', message });
  }
}
