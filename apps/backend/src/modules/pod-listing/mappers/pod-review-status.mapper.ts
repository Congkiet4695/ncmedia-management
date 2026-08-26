import { PodListingReviewStatus } from '@prisma/client';
import { TIKTOK_AUDIT_STATUS, TIKTOK_PRODUCT_STATUS } from '../../tiktok-sdk/tiktok-sdk.constants';
import type { TiktokProductDetail } from '../../tiktok-sdk/types/tiktok-product.types';

/** Kết quả đọc trạng thái duyệt của MỘT listing từ TikTok. */
export interface ReviewSnapshot {
  /** `null` khi sản phẩm vẫn còn là Draft phía TikTok — publish chưa "ăn". */
  status: PodListingReviewStatus | null;
  /** Chuỗi trạng thái GỐC của TikTok, giữ nguyên để đối chiếu. */
  raw: string | null;
  /** Lý do trượt duyệt đã gộp, `null` nếu không có. */
  reason: string | null;
}

/**
 * Trạng thái nào của TikTok là ĐÃ CHỐT — không cần hỏi lại nữa.
 *
 * `ACTIVE` KHÔNG nằm trong đây: sản phẩm đang bán vẫn có thể bị sàn gỡ hoặc người bán tắt,
 * và đó chính là thứ người vận hành cần biết. `DELETED` thì không đường quay lại, `REJECTED`
 * chỉ đổi khi người dùng sửa rồi publish lại (lúc đó hệ thống tự đặt lại về UNDER_REVIEW).
 */
export const REVIEW_TERMINAL_STATUSES: readonly PodListingReviewStatus[] = [
  PodListingReviewStatus.DELETED,
];

/**
 * TikTok `status` + `audit.status` ⇒ trạng thái duyệt của hệ thống.
 *
 * 🔴 Vì sao đọc CẢ HAI trường: `status` là trạng thái đã gộp (`PENDING` = đang duyệt,
 * `ACTIVATE` = đang bán) nhưng nó KHÔNG phân biệt được "đã qua duyệt, chờ điều kiện" với
 * "đang duyệt" — cả hai đều là `PENDING`. Chỉ `audit.status = PRE_APPROVED/APPROVED` mới nói
 * ra điều đó, và đó đúng là khác biệt giữa "chờ TikTok" và "chờ chính mình" (KYC, xin quyền
 * danh mục). Báo nhầm hai thứ này là để người vận hành ngồi đợi một việc không bao giờ tự xong.
 *
 * 🔴 Giá trị lạ (TikTok thêm trạng thái mới) ⇒ trả `null` chứ KHÔNG đoán. Cột `raw` vẫn giữ
 * nguyên chuỗi gốc, nên nhìn database là biết phải bổ sung nhánh nào.
 */
export function mapReviewStatus(
  productStatus: string | null | undefined,
  auditStatus: string | null | undefined,
): PodListingReviewStatus | null {
  switch (productStatus) {
    case TIKTOK_PRODUCT_STATUS.ACTIVATE:
      return PodListingReviewStatus.ACTIVE;
    case TIKTOK_PRODUCT_STATUS.DELETED:
      return PodListingReviewStatus.DELETED;
    case TIKTOK_PRODUCT_STATUS.SELLER_DEACTIVATED:
    case TIKTOK_PRODUCT_STATUS.PLATFORM_DEACTIVATED:
    case TIKTOK_PRODUCT_STATUS.FREEZE:
      return PodListingReviewStatus.OFFLINE;
    case TIKTOK_PRODUCT_STATUS.FAILED:
      return PodListingReviewStatus.REJECTED;
    case TIKTOK_PRODUCT_STATUS.SCHEDULED:
      return PodListingReviewStatus.APPROVED;
    case TIKTOK_PRODUCT_STATUS.PENDING:
      return auditStatus === TIKTOK_AUDIT_STATUS.APPROVED ||
        auditStatus === TIKTOK_AUDIT_STATUS.PRE_APPROVED
        ? PodListingReviewStatus.APPROVED
        : PodListingReviewStatus.UNDER_REVIEW;
    case TIKTOK_PRODUCT_STATUS.DRAFT:
    case TIKTOK_PRODUCT_STATUS.INITIAL:
      // Vẫn là Draft: lệnh publish chưa có tác dụng. Không tô màu "đang duyệt" cho một thứ
      // TikTok chưa hề nhận vào hàng chờ.
      return null;
    default:
      break;
  }

  // `status` trống hoặc lạ — thử đọc riêng kết quả audit trước khi bỏ cuộc.
  switch (auditStatus) {
    case TIKTOK_AUDIT_STATUS.AUDITING:
      return PodListingReviewStatus.UNDER_REVIEW;
    case TIKTOK_AUDIT_STATUS.FAILED:
      return PodListingReviewStatus.REJECTED;
    case TIKTOK_AUDIT_STATUS.APPROVED:
    case TIKTOK_AUDIT_STATUS.PRE_APPROVED:
      return PodListingReviewStatus.APPROVED;
    default:
      return null;
  }
}

/**
 * Gộp `audit_failed_reasons[]` thành MỘT chuỗi đọc được.
 *
 * Giữ cả `reasons` lẫn `suggestions`: lý do nói "sai ở đâu", gợi ý nói "sửa thế nào" — bỏ vế
 * sau là buộc người vận hành mở Seller Center để đọc nốt.
 */
export function joinAuditReasons(product: TiktokProductDetail): string | null {
  const parts: string[] = [];

  for (const reason of product.auditFailedReasons ?? []) {
    const detail = [...(reason.reasons ?? []), ...(reason.suggestions ?? [])]
      .map((text) => text.trim())
      .filter(Boolean)
      .join(' — ');
    if (!detail) continue;
    parts.push(reason.position ? `${reason.position}: ${detail}` : detail);
  }

  // `PRE_APPROVED` không phải lỗi nhưng vẫn là "chưa lên sàn vì còn thiếu gì đó" — nói ra
  // thì người vận hành biết phải đi làm KYC hay xin quyền danh mục.
  for (const pending of product.audit?.preApprovedReasons ?? []) {
    if (pending?.trim()) parts.push(pending.trim());
  }

  if (parts.length === 0) return null;
  return parts.join(' · ').slice(0, 2000);
}

/** Một lần đọc Get Product ⇒ ảnh chụp trạng thái duyệt để ghi vào database. */
export function toReviewSnapshot(product: TiktokProductDetail): ReviewSnapshot {
  return {
    status: mapReviewStatus(product.status, product.audit?.status),
    raw: product.status ?? product.productStatus ?? null,
    reason: joinAuditReasons(product),
  };
}
