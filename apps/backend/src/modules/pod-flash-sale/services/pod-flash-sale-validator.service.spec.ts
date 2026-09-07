import { PodFlashSaleItemStatus, Prisma } from '@prisma/client';
import {
  PodFlashSaleValidatorService,
  type ValidatableFlashSale,
  type ValidatableFlashSaleItem,
} from './pod-flash-sale-validator.service';
import {
  FLASH_SALE_ISSUE_CODES,
  FLASH_SALE_MIN_LEAD_SECONDS,
} from '../constants/pod-flash-sale.constants';

const D = (value: string | number) => new Prisma.Decimal(value);

/** Mốc "bây giờ" cố định — validator nhận `now` qua tham số nên không cần giả lập đồng hồ. */
const NOW = new Date('2026-09-01T00:00:00.000Z');
const IN_AN_HOUR = new Date('2026-09-01T01:00:00.000Z');
const IN_SEVEN_HOURS = new Date('2026-09-01T07:00:00.000Z');

function item(over: Partial<ValidatableFlashSaleItem> = {}): ValidatableFlashSaleItem {
  return {
    id: 'item-1',
    originalPrice: D('29.99'),
    flashSalePrice: D('20.99'),
    discountPercent: D('30'),
    totalPurchaseLimit: -1,
    customerPurchaseLimit: -1,
    providerProductId: '17295929697122',
    providerVariantId: '17295929697133',
    variantId: 'variant-1',
    currency: 'USD',
    status: PodFlashSaleItemStatus.READY,
    ...over,
  };
}

function flashSale(over: Partial<ValidatableFlashSale> = {}): ValidatableFlashSale {
  return {
    id: 'fs-1',
    name: 'Flash Sale 12.12',
    startAt: IN_AN_HOUR,
    endAt: IN_SEVEN_HOURS,
    items: [item()],
    ...over,
  };
}

describe('PodFlashSaleValidatorService', () => {
  const validator = new PodFlashSaleValidatorService();

  it('đợt sale đầy đủ và hợp lệ ⇒ ok, mọi dòng vào danh sách gửi được', () => {
    const result = validator.validate(flashSale(), NOW);
    expect(result.ok).toBe(true);
    expect(result.readyItemIds).toEqual(['item-1']);
  });

  it('không có dòng nào ⇒ chặn với mã NO_ITEMS', () => {
    const result = validator.validate(flashSale({ items: [] }), NOW);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(FLASH_SALE_ISSUE_CODES.NO_ITEMS);
  });

  it('mọi dòng đều hỏng ⇒ vẫn báo NO_ITEMS (không còn gì để gửi)', () => {
    const result = validator.validate(
      flashSale({ items: [item({ providerProductId: null })] }),
      NOW,
    );
    expect(result.readyItemIds).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toContain(FLASH_SALE_ISSUE_CODES.NO_ITEMS);
  });

  it('giờ kết thúc trước giờ bắt đầu ⇒ chặn, và KHÔNG kéo theo cảnh báo thời lượng', () => {
    const result = validator.validate(
      flashSale({ startAt: IN_SEVEN_HOURS, endAt: IN_AN_HOUR }),
      NOW,
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain(FLASH_SALE_ISSUE_CODES.TIME_RANGE_INVALID);
    expect(codes).not.toContain(FLASH_SALE_ISSUE_CODES.DURATION_TOO_SHORT);
  });

  it('giờ bắt đầu quá sát hiện tại ⇒ chặn (TikTok đòi begin_time > now)', () => {
    const tooSoon = new Date(NOW.getTime() + (FLASH_SALE_MIN_LEAD_SECONDS - 1) * 1_000);
    const result = validator.validate(
      flashSale({ startAt: tooSoon, endAt: new Date(tooSoon.getTime() + 3_600_000) }),
      NOW,
    );
    expect(result.issues.map((issue) => issue.code)).toContain(
      FLASH_SALE_ISSUE_CODES.START_IN_PAST,
    );
  });

  it('đúng mốc đệm tối thiểu ⇒ hợp lệ (biên là "được", không phải "vừa trượt")', () => {
    const exact = new Date(NOW.getTime() + FLASH_SALE_MIN_LEAD_SECONDS * 1_000);
    const result = validator.validate(
      flashSale({ startAt: exact, endAt: new Date(exact.getTime() + 3_600_000) }),
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it('đợt quá ngắn ⇒ CẢNH BÁO chứ không chặn', () => {
    const result = validator.validate(
      flashSale({ startAt: IN_AN_HOUR, endAt: new Date(IN_AN_HOUR.getTime() + 5 * 60_000) }),
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(
      result.issues.find((issue) => issue.code === FLASH_SALE_ISSUE_CODES.DURATION_TOO_SHORT)?.level,
    ).toBe('WARNING');
  });

  it('tên vượt 50 ký tự ⇒ chặn trước khi TikTok từ chối', () => {
    const result = validator.validate(flashSale({ name: 'x'.repeat(51) }), NOW);
    expect(result.issues.map((issue) => issue.code)).toContain(
      FLASH_SALE_ISSUE_CODES.NAME_TOO_LONG,
    );
  });

  it('thiếu TikTok Product ID ⇒ dòng đó bị loại khỏi danh sách gửi', () => {
    const result = validator.validate(
      flashSale({ items: [item(), item({ id: 'item-2', providerProductId: null })] }),
      NOW,
    );
    expect(result.readyItemIds).toEqual(['item-1']);
    expect(
      result.issues.find((issue) => issue.code === FLASH_SALE_ISSUE_CODES.MISSING_PROVIDER_ID)
        ?.itemId,
    ).toBe('item-2');
  });

  it('dòng biến thể thiếu TikTok SKU ID ⇒ bị loại; dòng mức sản phẩm thì không cần', () => {
    const variantMissingSku = item({ id: 'item-2', providerVariantId: null });
    const productLevelRow = item({ id: 'item-3', variantId: null, providerVariantId: null });

    const result = validator.validate(
      flashSale({ items: [variantMissingSku, productLevelRow] }),
      NOW,
    );
    expect(result.readyItemIds).toEqual(['item-3']);
  });

  it('dòng đã bị gỡ khỏi sàn không được kiểm và không vào danh sách gửi', () => {
    const removed = item({ id: 'item-2', status: PodFlashSaleItemStatus.REMOVED, providerProductId: null });
    const result = validator.validate(flashSale({ items: [item(), removed] }), NOW);
    expect(result.ok).toBe(true);
    expect(result.readyItemIds).toEqual(['item-1']);
  });

  it('trộn nhiều loại tiền ⇒ CẢNH BÁO, không chặn (shop đa vùng vẫn hợp lệ)', () => {
    const result = validator.validate(
      flashSale({ items: [item(), item({ id: 'item-2', currency: 'GBP' })] }),
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(
      result.issues.find((issue) => issue.code === FLASH_SALE_ISSUE_CODES.CURRENCY_MISMATCH)?.level,
    ).toBe('WARNING');
  });

  it('giá deal cao hơn giá gốc ⇒ dòng bị loại kèm mã lỗi của bộ tính giá', () => {
    const bad = item({ id: 'item-2', flashSalePrice: D('99'), discountPercent: D('-230') });
    const result = validator.validate(flashSale({ items: [item(), bad] }), NOW);
    expect(result.readyItemIds).toEqual(['item-1']);
    expect(result.issues.map((issue) => issue.code)).toContain(
      FLASH_SALE_ISSUE_CODES.PRICE_ABOVE_RETAIL,
    );
  });

  it('giới hạn mua ngoài dải [1,99] / -1 ⇒ dòng bị loại', () => {
    const bad = item({ id: 'item-2', customerPurchaseLimit: 0 });
    const result = validator.validate(flashSale({ items: [item(), bad] }), NOW);
    expect(result.readyItemIds).toEqual(['item-1']);
    expect(result.issues.map((issue) => issue.code)).toContain(
      FLASH_SALE_ISSUE_CODES.LIMIT_OUT_OF_RANGE,
    );
  });
});
