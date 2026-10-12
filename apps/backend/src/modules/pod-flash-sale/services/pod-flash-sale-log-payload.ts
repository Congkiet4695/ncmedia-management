import type { Prisma } from '@prisma/client';
import type { TiktokActivityDetail } from '../../tiktok-sdk/types/tiktok-promotion.types';

/**
 * Trần kích thước MỖI trường JSON (`request` / `response`) của một dòng `pod_flash_sale_logs`.
 *
 * 🔴 Vì sao có trần (docs/reports/database-storage-audit.md): log đồng bộ trạng thái từng lưu NGUYÊN
 * response Get Activity (mọi sản phẩm/SKU — trung bình 25,6 KB, tối đa ~129 KB) mỗi 5 phút cho mỗi đợt
 * sale ⇒ 7,2 GB trong 3 tuần. Log thao tác hợp lệ lớn nhất đo được là ~5,3 KB (request Update Products),
 * nên 16 KB không cắt log thật nhưng chặn mọi payload "lỡ tay" chép cả danh sách sản phẩm.
 */
export const FLASH_SALE_LOG_PAYLOAD_MAX_BYTES = 16 * 1024;

/** Độ dài phần xem trước giữ lại khi payload bị cắt. */
const TRUNCATED_PREVIEW_CHARS = 2_000;

/**
 * Tóm tắt Get Activity cho log đồng bộ trạng thái — CHỈ các trường TikTok thật sự trả về (xem
 * `TiktokActivityDetail`). Danh sách sản phẩm/SKU KHÔNG được chép: dòng đã gỡ được đối soát và ghi
 * vào `pod_flash_sale_items` (REMOVED), còn danh sách đầy đủ luôn đọc lại được từ TikTok bằng
 * `activityId` khi cần điều tra.
 */
export function summarizeActivity(activity: TiktokActivityDetail): {
  activityId: string | null;
  status: string | null;
  productLevel: string | null;
  beginTime: number | null;
  endTime: number | null;
  updateTime: number | null;
  activityCommands: string[];
  productCount: number;
  skuCount: number;
} {
  const products = activity.products ?? [];
  return {
    activityId: activity.activityId ?? null,
    status: activity.status ?? null,
    productLevel: activity.productLevel ?? null,
    beginTime: activity.beginTime ?? null,
    endTime: activity.endTime ?? null,
    updateTime: activity.updateTime ?? null,
    activityCommands: activity.activityCommands ?? [],
    productCount: products.length,
    skuCount: products.reduce((total, product) => total + (product.skus?.length ?? 0), 0),
  };
}

/**
 * Giữ nguyên payload nhỏ; payload vượt trần được thay bằng một mô tả có cấu trúc (kích thước gốc,
 * các khoá cấp 1, đoạn đầu) — người đọc log biết rằng đã bị cắt và cắt từ bao nhiêu.
 */
export function capLogPayload(
  value: Prisma.InputJsonValue | undefined,
  maxBytes = FLASH_SALE_LOG_PAYLOAD_MAX_BYTES,
): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value) ?? '';
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= maxBytes) return value;
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
  return {
    truncated: true,
    originalBytes: bytes,
    maxBytes,
    topLevelKeys: isObject ? Object.keys(value).slice(0, 50) : [],
    preview: json.slice(0, TRUNCATED_PREVIEW_CHARS),
  };
}
