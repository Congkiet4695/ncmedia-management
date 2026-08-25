import { Prisma, PodPricingMarkupType } from '@prisma/client';
import { evaluatePricingFormula } from './pod-pricing.formula';

/** Tham số công thức giá — đúng các cột của `pod_pricing_strategies`. */
export interface PricingInput {
  cost: Prisma.Decimal;
  shippingCost: Prisma.Decimal;
  markupType: PodPricingMarkupType;
  markupValue: Prisma.Decimal;
  /** Chỉ dùng khi `markupType = FORMULA`. */
  formula: string | null;
  retailPriceMultiplier: Prisma.Decimal;
  discountPercent: Prisma.Decimal;
  roundingIncrement: Prisma.Decimal;
  currency: string;
}

export interface PricingResult {
  /** Giá bán thực tế (TikTok: `sale_price`). */
  salePrice: Prisma.Decimal;
  /** Giá gốc hiển thị gạch ngang (TikTok: `original_price`). Bằng giá bán ⇒ không gạch ngang. */
  retailPrice: Prisma.Decimal;
  /** Giá sau khuyến mãi — để hiển thị/đối soát; TikTok tự tính khi chạy chương trình. */
  finalPrice: Prisma.Decimal;
  currency: string;
}

/**
 * Tính giá từ Pricing Strategy.
 *
 * 🔴 Không hardcode con số nào: mọi tham số (giá vốn, phí ship, mức lãi, hệ số giá gốc,
 * khuyến mãi, bước làm tròn, công thức) đều đến từ bản ghi chiến lược giá do người dùng tạo.
 *
 * ```
 *   base   = cost + shipping
 *   sale   = PERCENT → base × (1 + markup/100)
 *            FIXED   → base + markup
 *            FORMULA → giá trị biểu thức người dùng nhập (parser riêng, KHÔNG eval)
 *   sale   = làm tròn LÊN theo `roundingIncrement` (0 = không làm tròn)
 *   retail = sale × retailPriceMultiplier
 *   final  = sale × (1 − discount/100)
 * ```
 *
 * Dùng `Prisma.Decimal` xuyên suốt: tiền tệ tính bằng `number` của JS sẽ sai số ở
 * phép nhân phần trăm, và sai số đó chảy thẳng vào giá bán thật.
 */
export function calculatePricing(input: PricingInput): PricingResult {
  const base = input.cost.plus(input.shippingCost);

  const beforeRounding = computeSaleBeforeRounding(input, base);

  const salePrice = roundUpTo(beforeRounding, input.roundingIncrement);
  const retailPrice = salePrice.times(input.retailPriceMultiplier);
  const finalPrice = salePrice.times(
    new Prisma.Decimal(1).minus(input.discountPercent.dividedBy(100)),
  );

  return {
    salePrice: money(salePrice),
    retailPrice: money(retailPrice),
    finalPrice: money(finalPrice),
    currency: input.currency,
  };
}

function computeSaleBeforeRounding(input: PricingInput, base: Prisma.Decimal): Prisma.Decimal {
  switch (input.markupType) {
    case PodPricingMarkupType.PERCENT:
      return base.times(new Prisma.Decimal(1).plus(input.markupValue.dividedBy(100)));
    case PodPricingMarkupType.FIXED:
      return base.plus(input.markupValue);
    case PodPricingMarkupType.FORMULA:
      // Công thức rỗng ⇒ quay về giá vốn thay vì ném lỗi giữa lúc sinh listing hàng loạt:
      // tính đúng vẫn là 0 lãi, còn lỗi cú pháp đã bị chặn từ lúc LƯU chiến lược giá.
      return input.formula
        ? evaluatePricingFormula(input.formula, {
            cost: input.cost,
            shipping: input.shippingCost,
            base,
            markup: input.markupValue,
          })
        : base;
  }
}

/**
 * Làm tròn LÊN tới bội số gần nhất (vd bước 0.99 ⇒ 18.4 → 18.81).
 *
 * Làm tròn lên chứ không phải xuống: làm tròn xuống là **tự ăn vào lãi** trên mỗi đơn,
 * số nhỏ nhưng nhân với hàng nghìn đơn thì không nhỏ.
 */
function roundUpTo(value: Prisma.Decimal, increment: Prisma.Decimal): Prisma.Decimal {
  if (increment.lessThanOrEqualTo(0)) return value;
  const steps = value.dividedBy(increment).ceil();
  return steps.times(increment);
}

/** Chuẩn hoá về 2 chữ số thập phân — đơn vị tiền tệ thực tế của mọi thị trường TikTok. */
function money(value: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}
