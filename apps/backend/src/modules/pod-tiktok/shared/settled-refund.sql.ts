import { Prisma } from '@prisma/client';

/**
 * Tiền hoàn THỰC TẾ theo quyết toán của TikTok — nguồn DUY NHẤT cho mọi báo cáo refund.
 *
 * Đọc từ `revenue_breakdown` của statement transactions ĐÃ quyết toán
 * (`/finance/202501/.../statement_transactions`, đồng bộ sẵn bởi `PodPayoutSyncService`):
 *
 * ```
 *   refund_subtotal_before_discount_amount  (âm)   giá hàng bị hoàn, trước giảm giá của seller
 *   seller_discount_refund_amount           (dương) phần giảm giá seller được trả lại
 *   ─────────────────────────────────────────────
 *   settled refund = −(hai số trên)                 = doanh thu của seller bị TikTok trừ lại
 * ```
 *
 * Ví dụ thật (DB local): đơn 28.99, seller giảm 17.39, hoàn toàn bộ ⇒ −(−28.99 + 17.39) = 11.60 = đúng
 * doanh thu seller đã ghi nhận cho đơn đó.
 *
 * 🔴 KHÔNG trừ thêm số này khỏi lợi nhuận: `settlement_amount` (Est. Revenue / Proceeds) ĐÃ là số sau
 * hoàn tiền. Đây là chỉ số HIỂN THỊ để biết bao nhiêu doanh thu mất vì hoàn tiền.
 *
 * Mỗi giao dịch có `tiktok_transaction_id` UNIQUE ⇒ không cộng trùng giữa các lượt đồng bộ. Yêu cầu
 * Return/Refund KHÔNG được dùng làm nguồn tiền này (nhiều yêu cầu có thể cùng một đơn).
 */
export function settledRefundAmountSql(alias: string): Prisma.Sql {
  const t = Prisma.raw(alias);
  return Prisma.sql`-(
      ${numeric(Prisma.sql`${t}.revenue_breakdown->>'refund_subtotal_before_discount_amount'`)}
    + ${numeric(Prisma.sql`${t}.revenue_breakdown->>'seller_discount_refund_amount'`)})`;
}

/** Chuỗi số TikTok ⇒ numeric; rỗng / không phải số ⇒ 0 (không làm hỏng cả truy vấn vì một dòng lạ). */
function numeric(value: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(CASE WHEN ${value} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${value})::numeric ELSE 0 END)`;
}
