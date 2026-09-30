import { Injectable } from '@nestjs/common';
import { FulfillmentCatalogItemStatus } from '@prisma/client';
import { FulfillmentVariantPriceUnavailableException } from '../exceptions/fulfillment.exceptions';
import {
  FulfillmentCatalogRepository,
  type VariantPriceKey,
} from '../repositories/fulfillment-catalog.repository';

/** Nguồn của giá — hiện chỉ có danh mục đã đồng bộ từ API chính thức của nhà cung cấp. */
export const VARIANT_PRICE_SOURCE = 'PROVIDER_CATALOG' as const;

/** Vì sao không có giá cho một biến thể. */
export type VariantPriceFailure =
  | 'VARIANT_NOT_FOUND'
  | 'VARIANT_INACTIVE'
  | 'PRICE_MISSING'
  | 'PRICE_INVALID'
  | 'AMBIGUOUS';

/** Giá của ĐÚNG một biến thể nhà cung cấp. */
export interface ResolvedVariantPrice {
  accountId: string;
  variantId: string;
  externalVariantId: string;
  sku: string;
  /** Giá vốn nhà cung cấp cho một đơn vị (≥ 0, tối đa 4 chữ số thập phân — khớp cột `base_cost`). */
  price: number;
  currency: string | null;
  source: typeof VARIANT_PRICE_SOURCE;
  /** Thời điểm bản ghi giá được đồng bộ từ nhà cung cấp. */
  syncedAt: string;
}

export type VariantPriceResult =
  | { ok: true; price: ResolvedVariantPrice }
  | { ok: false; reason: VariantPriceFailure; message: string };

const DECIMAL_PRICE = /^\d+(\.\d+)?$/;

/**
 * Chuỗi giá nhà cung cấp → số. `null` khi không phải số không âm hợp lệ.
 *
 * Mango trả `price` dạng chuỗi (`"23.89"`); Sellerwix trả `cost` dạng số và được lưu lại thành chuỗi
 * (`FulfillmentVariant.price` là VARCHAR để không mất định dạng). Không đoán đơn vị, không bỏ ký tự
 * lạ: giá sai định dạng là `PRICE_INVALID`, không phải 0.
 */
export function parseProviderPrice(raw: string | null | undefined): number | null {
  const value = raw?.trim();
  if (!value || !DECIMAL_PRICE.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 10_000) / 10_000;
}

/**
 * FulfillmentVariantPriceService — **giá vốn của MỘT biến thể nhà cung cấp**.
 *
 * ```
 *   Mango / Sellerwix API ──(đồng bộ danh mục)──▶ fulfillment_variants.price
 *                                                      │
 *   Cấu hình sản phẩm (xem trước) ─────────────────────┤  lookup / require
 *   Lưu ánh xạ (ghi fulfillment_product_mappings.base_cost) ┘
 * ```
 *
 * 🔴 Theo kiến trúc hiện có, danh mục nhà cung cấp được ĐỒNG BỘ vào database (giao diện chọn Product
 * / Variant đọc từ đó), nên giá cũng đọc từ ĐÚNG bản ghi biến thể đó — cùng nguồn với danh sách
 * người dùng vừa chọn. Không gọi API nhà cung cấp mỗi lần mở ô chọn (rate limit, chậm), không lấy
 * giá từ frontend, không có giá mặc định.
 *
 * Phạm vi: chỉ biến thể của tài khoản mà tổ chức ĐƯỢC DÙNG (tài khoản riêng hoặc dùng chung).
 */
@Injectable()
export class FulfillmentVariantPriceService {
  constructor(private readonly catalogRepo: FulfillmentCatalogRepository) {}

  /** Tra giá — không ném lỗi khi không có giá (nơi gọi tự quyết). */
  async lookup(
    organizationId: string,
    accountId: string,
    key: VariantPriceKey,
  ): Promise<VariantPriceResult> {
    const rows = await this.catalogRepo.findVariantsForPrice(organizationId, accountId, key);
    const label = key.sku?.trim() || key.externalVariantId?.trim() || key.id || '';

    if (rows.length === 0) {
      return {
        ok: false,
        reason: 'VARIANT_NOT_FOUND',
        message:
          `Không tìm thấy biến thể ${label} trong danh mục đã đồng bộ của nhà cung cấp. ` +
          'Đồng bộ lại danh mục rồi chọn lại biến thể.',
      };
    }

    const active = rows.filter((row) => row.status === FulfillmentCatalogItemStatus.ACTIVE);
    if (active.length === 0) {
      return {
        ok: false,
        reason: 'VARIANT_INACTIVE',
        message: `Biến thể ${label} đã ngừng bán ở nhà cung cấp — chọn biến thể khác.`,
      };
    }

    const priced = active.map((row) => ({ row, price: parseProviderPrice(row.price) }));
    const withPrice = priced.filter((entry) => entry.price !== null);
    if (withPrice.length === 0) {
      const raw = active[0].price?.trim();
      return raw
        ? {
            ok: false,
            reason: 'PRICE_INVALID',
            message: `Giá nhà cung cấp của biến thể ${label} không hợp lệ ("${raw}") — không cập nhật Base Cost.`,
          }
        : {
            ok: false,
            reason: 'PRICE_MISSING',
            message:
              `Nhà cung cấp không trả giá cho biến thể ${label}. Đồng bộ lại danh mục; nếu vẫn ` +
              'thiếu, nhà cung cấp chưa công bố giá cho biến thể này.',
          };
    }

    // Cùng khoá mà nhiều bản ghi mang giá KHÁC nhau ⇒ không biết giá nào đúng — không đoán.
    const distinct = new Set(withPrice.map((entry) => entry.price));
    if (distinct.size > 1) {
      return {
        ok: false,
        reason: 'AMBIGUOUS',
        message: `Biến thể ${label} khớp nhiều bản ghi với giá khác nhau — chọn lại đúng biến thể.`,
      };
    }

    const { row, price } = withPrice[0];
    return {
      ok: true,
      price: {
        accountId,
        variantId: row.id,
        externalVariantId: row.externalVariantId,
        sku: row.sku,
        price: price as number,
        currency: row.product?.currency?.trim() || null,
        source: VARIANT_PRICE_SOURCE,
        syncedAt: row.syncedAt.toISOString(),
      },
    };
  }

  /** Như `lookup`, nhưng không có giá ⇒ 422 `FULFILLMENT_VARIANT_PRICE_UNAVAILABLE` kèm lý do. */
  async require(
    organizationId: string,
    accountId: string,
    key: VariantPriceKey,
  ): Promise<ResolvedVariantPrice> {
    const result = await this.lookup(organizationId, accountId, key);
    if (!result.ok) throw new FulfillmentVariantPriceUnavailableException(result.reason, result.message);
    return result.price;
  }
}
