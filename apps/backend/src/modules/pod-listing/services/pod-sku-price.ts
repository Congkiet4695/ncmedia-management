import { Prisma } from '@prisma/client';

/**
 * Giá của MỘT tổ hợp SKU — **nguồn sự thật duy nhất** cho cả cổng validate, payload gửi
 * TikTok lẫn con số hiển thị trên màn hình SKU Template.
 *
 * ```
 *   retailPrice  →  giá gốc, hiển thị gạch ngang   (TikTok: original_price)
 *   salePrice    →  giá bán thực tế                 (TikTok: price.amount)
 *   discount (%) →  cách khai giá bán theo lối "giá gốc trừ %"
 * ```
 *
 * Quy tắc (BR-20b của `docs/pod-product/03-template-engine.md`):
 *
 * ```
 *   1. salePrice có giá trị dùng được  ⇒ đó là giá bán (khai tường minh thì thắng)
 *   2. ngược lại, retailPrice dùng được:
 *        discount > 0  ⇒ giá bán = retail × (1 − discount/100)
 *        không         ⇒ giá bán = retail          (bán đúng giá gốc, không gạch ngang)
 *   3. cả hai đều trống ⇒ null  (để tầng trên rơi về Pricing Template / giá mặc định)
 * ```
 *
 * 🔴 **`0` nghĩa là CHƯA ĐẶT, không phải "miễn phí".** TikTok từ chối SKU giá 0, và ô giá bỏ
 * trống trên lưới từng ghi xuống `0` — coi 0 là một giá hợp lệ chính là lý do một SKU khai
 * "Retail 19.99, giảm 30%" bị báo "chưa có giá bán hợp lệ".
 */
export interface SkuPriceInput {
  retailPrice: Prisma.Decimal | null;
  salePrice: Prisma.Decimal | null;
  /** Phần trăm giảm so với giá gốc (0–100). */
  discount: Prisma.Decimal | null;
}

export interface SkuPriceResult {
  /** Giá bán thực tế; `null` = tổ hợp này chưa tự khai giá. */
  salePrice: Prisma.Decimal | null;
  /** Giá gốc gạch ngang; `null` = không hiển thị gạch ngang. */
  retailPrice: Prisma.Decimal | null;
  /** Vì sao ra con số đó — để log và để màn hình giải thích cho người dùng. */
  source: 'SALE_PRICE' | 'RETAIL_WITH_DISCOUNT' | 'RETAIL_PRICE' | 'NONE';
}

/** Giá dùng được = có giá trị VÀ lớn hơn 0. */
export function isUsablePrice(value: Prisma.Decimal | null | undefined): value is Prisma.Decimal {
  return value !== null && value !== undefined && value.greaterThan(0);
}

/** Phần trăm giảm hợp lệ: trong khoảng (0, 100]. Ngoài khoảng ⇒ coi như không giảm. */
function isUsableDiscount(value: Prisma.Decimal | null | undefined): value is Prisma.Decimal {
  return value !== null && value !== undefined && value.greaterThan(0) && value.lessThanOrEqualTo(100);
}

/** Chuẩn hoá về 2 chữ số thập phân — đơn vị tiền tệ thực tế của mọi thị trường TikTok. */
function money(value: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

/**
 * Giá bán + giá gạch ngang của một tổ hợp SKU.
 *
 * Hàm THUẦN, không chạm database: dùng chung được cho bộ giải listing (backend) và cột "giá
 * bán hiệu lực" trên lưới SKU, nên hai nơi không bao giờ nói hai con số khác nhau.
 */
export function resolveSkuItemPrice(input: SkuPriceInput): SkuPriceResult {
  const retail = isUsablePrice(input.retailPrice) ? money(input.retailPrice) : null;

  if (isUsablePrice(input.salePrice)) {
    return { salePrice: money(input.salePrice), retailPrice: retail, source: 'SALE_PRICE' };
  }

  if (retail === null) {
    return { salePrice: null, retailPrice: null, source: 'NONE' };
  }

  if (isUsableDiscount(input.discount)) {
    const discounted = retail.times(new Prisma.Decimal(1).minus(input.discount.dividedBy(100)));
    // Giảm 100% cho ra 0 — TikTok từ chối, nên coi như chưa khai giá thay vì gửi một con số
    // chắc chắn hỏng.
    const salePrice = money(discounted);
    return salePrice.greaterThan(0)
      ? { salePrice, retailPrice: retail, source: 'RETAIL_WITH_DISCOUNT' }
      : { salePrice: null, retailPrice: retail, source: 'NONE' };
  }

  // Không giảm giá ⇒ bán đúng giá gốc. KHÔNG trả `retailPrice` để khỏi gạch ngang một con số
  // bằng chính giá bán (TikTok từ chối `original_price` ≤ `price`).
  return { salePrice: retail, retailPrice: null, source: 'RETAIL_PRICE' };
}
