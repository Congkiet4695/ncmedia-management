import { Prisma } from '@prisma/client';
import { NON_BLOCKING_FULFILLMENT_STATUSES } from '../../fulfillment/shared/fulfillment-lifecycle';

/**
 * Lợi nhuận TỪNG ĐƠN bằng SQL — bản tổng hợp ở DB của `calculateOrderFinancials` (`order-financials.ts`,
 * hàm mà cột "Giá" của màn Order dùng) + `productCostOf` (`fulfillment/shared/product-cost.ts`).
 *
 * 🔴 MỘT công thức với màn Order — KHÔNG phải công thức PF của Dashboard (Dashboard coi đơn chưa có giá
 * vốn là giá vốn 0). Ở đây đơn thiếu dữ kiện có `profit = NULL`, đúng như màn Order hiển thị "—":
 *
 * ```
 *   tiền thu về = Σ settlement_amount giao dịch ORDER đã quyết toán (MỘT đơn vị tiền)
 *                 — không có ⇒ Σ est_settlement_amount giao dịch ORDER chưa quyết toán (MỘT đơn vị tiền)
 *   giá vốn     = lần fulfill ĐANG giữ đơn (mới nhất theo updated_at, bỏ DRAFT/FAILED/CANCELLED/REJECTED):
 *                 Σ base_cost × quantity — chỉ khi CÓ dòng, MỌI dòng có giá và ĐÃ được xác nhận
 *   lợi nhuận   = tiền thu về − giá vốn, khi giá vốn có đơn vị tiền và TRÙNG đơn vị tiền thu về
 *                 — ngược lại NULL (NO_PROCEEDS / NO_COST / COST_PENDING / COST_CURRENCY_UNKNOWN / CURRENCY_MISMATCH)
 * ```
 *
 * Làm tròn 4 chữ số như bản TS. Bộ đối chiếu từng đơn với bản TS trên DB thật:
 * `test/manual/e2e-employee-work.manual.ts`.
 *
 * Trả về các CTE nối sau `WITH`; CTE cuối `order_profit(id, shop_id, profit)`. Nơi gọi định nghĩa trước
 * CTE `o(id, tiktok_order_id, shop_id)` — tập đơn cần tính (đã lọc tổ chức / ngày / đơn vị tiền / shop).
 */
export function orderProfitCtes(organizationId: string): Prisma.Sql {
  return Prisma.sql`
    settled AS (
      SELECT t.tiktok_order_id,
             COUNT(DISTINCT UPPER(t.currency)) AS currencies,
             MIN(UPPER(t.currency))            AS currency,
             ROUND(SUM(t.settlement_amount), 4) AS amount
        FROM pod_tiktok_statement_transactions t
        JOIN o ON o.tiktok_order_id = t.tiktok_order_id
       WHERE t.organization_id = ${organizationId}::uuid AND t.deleted_at IS NULL
         AND t.type = 'ORDER'::"pod_statement_tx_type" AND t.settlement_amount IS NOT NULL
       GROUP BY t.tiktok_order_id
    ),
    unsettled AS (
      SELECT u.tiktok_order_id,
             COUNT(DISTINCT UPPER(u.currency)) AS currencies,
             MIN(UPPER(u.currency))            AS currency,
             ROUND(SUM(u.est_settlement_amount), 4) AS amount
        FROM pod_tiktok_unsettled_transactions u
        JOIN o ON o.tiktok_order_id = u.tiktok_order_id
       WHERE u.organization_id = ${organizationId}::uuid AND u.deleted_at IS NULL
         AND u.type = 'ORDER' AND u.est_settlement_amount IS NOT NULL
       GROUP BY u.tiktok_order_id
    ),
    cost_record AS (
      SELECT DISTINCT ON (f.pod_order_id) f.id, f.pod_order_id, UPPER(NULLIF(f.currency, '')) AS currency
        FROM fulfillment_orders f
        JOIN o ON o.id = f.pod_order_id
       WHERE f.organization_id = ${organizationId}::uuid AND f.deleted_at IS NULL
         AND f.status::text NOT IN (${Prisma.join([...NON_BLOCKING_FULFILLMENT_STATUSES])})
       ORDER BY f.pod_order_id, f.updated_at DESC
    ),
    cost AS (
      SELECT cr.pod_order_id, cr.currency,
             COUNT(i.id)                                                 AS items,
             COUNT(i.id) FILTER (WHERE i.base_cost IS NULL)              AS unpriced,
             COUNT(i.id) FILTER (WHERE i.base_cost_confirmed_at IS NULL) AS unconfirmed,
             ROUND(SUM(i.base_cost * COALESCE(NULLIF(i.quantity, 0), 1)), 4) AS amount
        FROM cost_record cr
        LEFT JOIN fulfillment_order_items i ON i.fulfillment_order_id = cr.id AND i.deleted_at IS NULL
       GROUP BY cr.pod_order_id, cr.currency
    ),
    order_profit AS (
      SELECT o.id, o.shop_id,
             CASE
               WHEN pr.amount IS NULL THEN NULL
               WHEN c.items IS NULL OR c.items = 0 OR c.unpriced > 0 OR c.unconfirmed > 0 THEN NULL
               WHEN c.currency IS NULL OR c.currency <> pr.currency THEN NULL
               ELSE ROUND(pr.amount - c.amount, 4)
             END AS profit
        FROM o
        LEFT JOIN settled s   ON s.tiktok_order_id = o.tiktok_order_id
        LEFT JOIN unsettled u ON u.tiktok_order_id = o.tiktok_order_id
        LEFT JOIN LATERAL (
          SELECT CASE WHEN s.currencies = 1 THEN s.amount WHEN u.currencies = 1 THEN u.amount END AS amount,
                 CASE WHEN s.currencies = 1 THEN s.currency WHEN u.currencies = 1 THEN u.currency END AS currency
        ) pr ON TRUE
        LEFT JOIN cost c ON c.pod_order_id = o.id
    )`;
}
