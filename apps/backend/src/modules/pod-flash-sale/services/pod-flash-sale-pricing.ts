import { Prisma } from '@prisma/client';
import {
  FLASH_SALE_DISCOUNT_SCALE,
  FLASH_SALE_ISSUE_CODES,
  FLASH_SALE_MAX_DISCOUNT_PERCENT,
  FLASH_SALE_MAX_QUANTITY,
  FLASH_SALE_MIN_DISCOUNT_PERCENT,
  FLASH_SALE_MIN_PRICE,
  FLASH_SALE_MIN_QUANTITY,
  FLASH_SALE_PRICE_SCALE,
  FLASH_SALE_UNLIMITED,
  type PodFlashSaleIssueCode,
} from '../constants/pod-flash-sale.constants';

/**
 * Bộ tính giá Flash Sale — **hàm thuần, không Nest, không Prisma Client**.
 *
 * 🔴 Tách khỏi service vì đây là chỗ dễ sai nhất của cả module và là chỗ duy nhất bắt buộc
 * phải có unit test: một lỗi làm tròn ở đây là bán hàng sai giá trên sàn thật. Tách ra thì
 * kiểm được toàn bộ ranh giới (0, giá gốc, 99.995…) mà không cần dựng database.
 *
 * 🔴 Toàn bộ phép tính dùng `Prisma.Decimal`. `29.99 * 0.7` trong JS cho `20.992999999999995`;
 * làm tròn con số đó ra tiền thật là đúng nghĩa sai số chảy vào doanh thu.
 *
 * Hai chiều tính, cùng một sự thật:
 * ```
 *   Discount %  ──▶  Deal = round(Retail × (1 − p/100), 2)
 *   Fixed Price ──▶  p    = round((1 − Deal/Retail) × 100, 4)
 * ```
 * Ví dụ của yêu cầu: Retail `29.99`, giảm `30%` ⇒ Deal `20.99`.
 */

/** Một lỗi/cảnh báo của một dòng sản phẩm. */
export interface FlashSaleIssue {
  level: 'ERROR' | 'WARNING';
  code: PodFlashSaleIssueCode;
  field: string;
  message: string;
}

/** Giá đã tính xong của một dòng. */
export interface FlashSalePricing {
  originalPrice: Prisma.Decimal;
  flashSalePrice: Prisma.Decimal;
  discountPercent: Prisma.Decimal;
}

/** Đầu vào của một lần tính giá: chọn ĐÚNG MỘT trong hai cách. */
export interface FlashSalePriceInput {
  /** Giá niêm yết đang bán. */
  originalPrice: Prisma.Decimal | string | number;
  /** Cách 1 — nhập % giảm, hệ thống tính giá deal. */
  discountPercent?: Prisma.Decimal | string | number | null;
  /** Cách 2 — nhập thẳng giá deal, hệ thống tính % giảm. */
  flashSalePrice?: Prisma.Decimal | string | number | null;
}

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/** Ép mọi kiểu số về `Decimal`; `null`/`undefined`/không phải số ⇒ `null`. */
export function toDecimal(value: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const decimal = new Prisma.Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    // Chuỗi rác từ client (`"abc"`, `"1,5"`) — trả `null` để nơi gọi sinh issue có mã rõ
    // ràng, thay vì để một exception thô của thư viện trồi lên tận controller.
    return null;
  }
}

/**
 * Tính giá deal + % giảm từ MỘT trong hai cách nhập.
 *
 * 🔴 Ưu tiên `flashSalePrice` khi client gửi cả hai: người dùng gõ thẳng con số tiền là ý
 * định rõ ràng nhất, còn `discountPercent` có thể chỉ là giá trị cũ còn sót trong form.
 * Dù đi đường nào, **cả hai cột đều được tính lại** — không bao giờ tin số client gửi kèm.
 *
 * Trả `null` khi không đủ dữ liệu để tính (nơi gọi sinh issue tương ứng).
 */
export function computeFlashSalePricing(input: FlashSalePriceInput): FlashSalePricing | null {
  const originalPrice = toDecimal(input.originalPrice);
  if (!originalPrice || originalPrice.lessThanOrEqualTo(ZERO)) return null;

  const explicitPrice = toDecimal(input.flashSalePrice ?? null);
  if (explicitPrice) {
    const flashSalePrice = roundPrice(explicitPrice);
    return { originalPrice, flashSalePrice, discountPercent: percentOf(originalPrice, flashSalePrice) };
  }

  const percent = toDecimal(input.discountPercent ?? null);
  if (!percent) return null;

  // Deal = Retail × (1 − p/100). Nhân trước, chia sau, làm tròn MỘT lần ở cuối — làm tròn
  // giữa chừng là cách chắc chắn để lệch một xu so với con số người dùng nhìn thấy.
  const flashSalePrice = roundPrice(
    originalPrice.mul(HUNDRED.minus(percent)).div(HUNDRED),
  );
  // Tính lại % từ giá đã làm tròn, KHÔNG giữ nguyên % người dùng nhập: giá gửi lên sàn là
  // giá đã làm tròn, nên % hiển thị phải là % của chính con số đó.
  return { originalPrice, flashSalePrice, discountPercent: percentOf(originalPrice, flashSalePrice) };
}

/** `(1 − deal/retail) × 100`, làm tròn theo `Decimal(7,4)` của schema. */
export function percentOf(originalPrice: Prisma.Decimal, flashSalePrice: Prisma.Decimal): Prisma.Decimal {
  if (originalPrice.lessThanOrEqualTo(ZERO)) return ZERO;
  return HUNDRED.minus(flashSalePrice.div(originalPrice).mul(HUNDRED)).toDecimalPlaces(
    FLASH_SALE_DISCOUNT_SCALE,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}

/**
 * Làm tròn giá về 2 chữ số thập phân.
 *
 * 🔴 `ROUND_HALF_UP` (không phải `ROUND_HALF_EVEN`): đây là con số hiển thị cho người mua
 * và người vận hành, phải khớp với phép làm tròn mà ai cũng nhẩm được trong đầu.
 */
export function roundPrice(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(FLASH_SALE_PRICE_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Kiểm tra một dòng đã tính xong.
 *
 * Bốn luật của yêu cầu, theo đúng thứ tự: không âm · không dưới giá tối thiểu · không vượt
 * giá gốc · % giảm trong dải cho phép.
 */
export function validatePricing(
  pricing: FlashSalePricing,
  field = 'flashSalePrice',
): FlashSaleIssue[] {
  const issues: FlashSaleIssue[] = [];
  const { originalPrice, flashSalePrice, discountPercent } = pricing;

  if (flashSalePrice.lessThanOrEqualTo(ZERO)) {
    issues.push({
      level: 'ERROR',
      code: FLASH_SALE_ISSUE_CODES.PRICE_NOT_POSITIVE,
      field,
      message: 'Giá Flash Sale phải lớn hơn 0.',
    });
    // Giá âm/bằng 0 làm mọi phép kiểm còn lại vô nghĩa — dừng ở đây để người dùng nhận
    // đúng MỘT thông điệp thay vì một chuỗi lỗi phái sinh.
    return issues;
  }

  if (flashSalePrice.lessThan(FLASH_SALE_MIN_PRICE)) {
    issues.push({
      level: 'ERROR',
      code: FLASH_SALE_ISSUE_CODES.PRICE_BELOW_MINIMUM,
      field,
      message: `Giá Flash Sale không được thấp hơn mức tối thiểu ${FLASH_SALE_MIN_PRICE}.`,
    });
  }

  if (flashSalePrice.greaterThan(originalPrice)) {
    issues.push({
      level: 'ERROR',
      code: FLASH_SALE_ISSUE_CODES.PRICE_ABOVE_RETAIL,
      field,
      message: 'Giá Flash Sale không được lớn hơn giá niêm yết.',
    });
  }

  if (
    discountPercent.lessThanOrEqualTo(FLASH_SALE_MIN_DISCOUNT_PERCENT) ||
    discountPercent.greaterThanOrEqualTo(FLASH_SALE_MAX_DISCOUNT_PERCENT)
  ) {
    issues.push({
      level: 'ERROR',
      code: FLASH_SALE_ISSUE_CODES.DISCOUNT_OUT_OF_RANGE,
      field: 'discountPercent',
      message:
        `% giảm phải nằm trong khoảng (${FLASH_SALE_MIN_DISCOUNT_PERCENT}, ` +
        `${FLASH_SALE_MAX_DISCOUNT_PERCENT}) — giá deal phải THẤP HƠN giá niêm yết và lớn hơn 0.`,
    });
  }

  return issues;
}

/**
 * Kiểm tra một giới hạn mua: `[1, 99]` hoặc `-1` (không giới hạn).
 *
 * Dải này của TikTok, không phải của hệ thống — xem `TIKTOK_ACTIVITY_*_QUANTITY`.
 */
export function validateQuantityLimit(value: number, field: string): FlashSaleIssue[] {
  if (value === FLASH_SALE_UNLIMITED) return [];
  if (!Number.isInteger(value) || value < FLASH_SALE_MIN_QUANTITY || value > FLASH_SALE_MAX_QUANTITY) {
    return [
      {
        level: 'ERROR',
        code: FLASH_SALE_ISSUE_CODES.LIMIT_OUT_OF_RANGE,
        field,
        message:
          `Giới hạn mua phải là số nguyên trong [${FLASH_SALE_MIN_QUANTITY}, ` +
          `${FLASH_SALE_MAX_QUANTITY}], hoặc ${FLASH_SALE_UNLIMITED} để bỏ giới hạn.`,
      },
    ];
  }
  return [];
}

/** Định dạng giá thành CHUỖI đúng như TikTok yêu cầu (`activity_price_amount`). */
export function formatPriceForProvider(value: Prisma.Decimal): string {
  return roundPrice(value).toFixed(FLASH_SALE_PRICE_SCALE);
}
