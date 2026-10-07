import { Prisma } from '@prisma/client';
import { NON_BLOCKING_FULFILLMENT_STATUSES } from '../../fulfillment/shared/fulfillment-lifecycle';
import { TIKTOK_SHIPPING_TYPE, type LabelCostConfig } from './order-financials';

/** Số tiền dạng chuỗi trong breakdown JSON của TikTok ⇒ numeric; chuỗi rỗng / không phải số ⇒ NULL (không ném lỗi). */
function jsonAmount(path: string): Prisma.Sql {
  return Prisma.raw(`(CASE WHEN (${path}) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${path})::numeric END)`);
}

/**
 * Lợi nhuận TỪNG ĐƠN bằng SQL — bản tổng hợp ở DB của `calculateOrderFinancials` (`order-financials.ts`,
 * hàm mà cột "Giá" của màn Order dùng) + `productCostOf` (`fulfillment/shared/product-cost.ts`).
 *
 * 🔴 MỘT công thức cho mọi nơi (màn Order, Thống kê công việc nhân viên, Dashboard). Đơn thiếu dữ kiện có
 * `profit = NULL`, đúng như màn Order hiển thị "—":
 *
 * ```
 *   tiền thu về = Σ settlement_amount giao dịch ORDER đã quyết toán (MỘT đơn vị tiền)
 *                 — không có ⇒ Σ est_settlement_amount giao dịch ORDER chưa quyết toán (MỘT đơn vị tiền)
 *   giá vốn     = lần fulfill ĐANG giữ đơn (mới nhất theo updated_at, bỏ DRAFT/FAILED/CANCELLED/REJECTED):
 *                 Σ base_cost × quantity — chỉ khi CÓ dòng, MỌI dòng có giá và ĐÃ được xác nhận
 *   phí ship    = đã quyết toán ⇒ −Σ shipping_cost_amount (ĐÃ trong tiền thu về)
 *                 ước tính, TikTok đã tính (est_shipping_cost ≠ 0 / actual_shipping_fee ≠ 0) ⇒ −Σ est_shipping_cost (ĐÃ trong)
 *                 ước tính, chưa tính, shipping_type TIKTOK ⇒ −Σ seller_shipping_fee_discount_amount
 *                   (breakdown thiếu ⇒ pod_orders.shipping_fee_seller_discount) — CHƯA trong tiền thu về
 *                 còn lại ⇒ NULL
 *   lợi nhuận   = tiền thu về − giá vốn − phí ship CHƯA trong tiền thu về − label (mỗi đơn một lần),
 *                 khi giá vốn & label CÙNG đơn vị tiền thu về — ngược lại NULL
 * ```
 *
 * Làm tròn 4 chữ số như bản TS. Bộ đối chiếu từng đơn với bản TS trên DB thật:
 * `test/manual/e2e-employee-work.manual.ts`.
 *
 * Trả về các CTE nối sau `WITH` (tên tiền tố `op_` để không đụng CTE của nơi gọi); CTE cuối
 * `order_profit(id, shop_id, profit)`. Nơi gọi định nghĩa trước CTE `o(id, tiktok_order_id, shop_id)` — tập
 * đơn cần tính (đã lọc tổ chức / ngày / đơn vị tiền / shop).
 */
export function orderProfitCtes(organizationId: string, label: LabelCostConfig): Prisma.Sql {
  const actualFee = jsonAmount(`u.shipping_cost_breakdown->>'actual_shipping_fee_amount'`);
  const sellerDiscount = jsonAmount(
    `u.shipping_cost_breakdown->'supplementary_component'->>'seller_shipping_fee_discount_amount'`,
  );
  return Prisma.sql`
    op_settled AS (
      SELECT t.tiktok_order_id,
             COUNT(DISTINCT UPPER(t.currency))       AS currencies,
             MIN(UPPER(t.currency))                  AS currency,
             ROUND(SUM(t.settlement_amount), 4)      AS amount,
             ROUND(SUM(t.shipping_cost_amount), 4)   AS ship
        FROM pod_tiktok_statement_transactions t
        JOIN o ON o.tiktok_order_id = t.tiktok_order_id
       WHERE t.organization_id = ${organizationId}::uuid AND t.deleted_at IS NULL
         AND t.type = 'ORDER'::"pod_statement_tx_type" AND t.settlement_amount IS NOT NULL
       GROUP BY t.tiktok_order_id
    ),
    op_unsettled AS (
      SELECT u.tiktok_order_id,
             COUNT(DISTINCT UPPER(u.currency))          AS currencies,
             MIN(UPPER(u.currency))                     AS currency,
             ROUND(SUM(u.est_settlement_amount), 4)     AS amount,
             ROUND(SUM(u.est_shipping_cost_amount), 4)  AS ship,
             BOOL_OR(COALESCE(${actualFee}, 0) <> 0)    AS any_actual,
             BOOL_AND(COALESCE(jsonb_typeof(u.shipping_cost_breakdown) = 'object', FALSE)) AS complete,
             BOOL_AND(${sellerDiscount} IS NOT NULL)    AS discount_known,
             ROUND(SUM(${sellerDiscount}), 4)           AS discount
        FROM pod_tiktok_unsettled_transactions u
        JOIN o ON o.tiktok_order_id = u.tiktok_order_id
       WHERE u.organization_id = ${organizationId}::uuid AND u.deleted_at IS NULL
         AND u.type = 'ORDER' AND u.est_settlement_amount IS NOT NULL
       GROUP BY u.tiktok_order_id
    ),
    op_cost_record AS (
      SELECT DISTINCT ON (f.pod_order_id) f.id, f.pod_order_id, UPPER(NULLIF(f.currency, '')) AS currency
        FROM fulfillment_orders f
        JOIN o ON o.id = f.pod_order_id
       WHERE f.organization_id = ${organizationId}::uuid AND f.deleted_at IS NULL
         AND f.status::text NOT IN (${Prisma.join([...NON_BLOCKING_FULFILLMENT_STATUSES])})
       ORDER BY f.pod_order_id, f.updated_at DESC
    ),
    op_cost AS (
      SELECT cr.pod_order_id, cr.currency,
             COUNT(i.id)                                                 AS items,
             COUNT(i.id) FILTER (WHERE i.base_cost IS NULL)              AS unpriced,
             COUNT(i.id) FILTER (WHERE i.base_cost_confirmed_at IS NULL) AS unconfirmed,
             ROUND(SUM(i.base_cost * COALESCE(NULLIF(i.quantity, 0), 1)), 4) AS amount
        FROM op_cost_record cr
        LEFT JOIN fulfillment_order_items i ON i.fulfillment_order_id = cr.id AND i.deleted_at IS NULL
       GROUP BY cr.pod_order_id, cr.currency
    ),
    order_profit AS (
      SELECT o.id, o.shop_id,
             CASE
               WHEN pr.amount IS NULL THEN NULL
               WHEN c.items IS NULL OR c.items = 0 OR c.unpriced > 0 OR c.unconfirmed > 0 THEN NULL
               WHEN c.currency IS NULL OR c.currency <> pr.currency THEN NULL
               WHEN sh.amount IS NULL THEN NULL
               WHEN UPPER(${label.currency}) <> pr.currency THEN NULL
               ELSE ROUND(
                 pr.amount - c.amount - CASE WHEN sh.included THEN 0 ELSE sh.amount END - ${label.amount}::numeric,
                 4)
             END AS profit
        FROM o
        JOIN pod_orders po ON po.id = o.id
        LEFT JOIN op_settled s   ON s.tiktok_order_id = o.tiktok_order_id
        LEFT JOIN op_unsettled u ON u.tiktok_order_id = o.tiktok_order_id
        LEFT JOIN LATERAL (
          SELECT CASE WHEN s.currencies = 1 THEN 'S' WHEN u.currencies = 1 THEN 'U' END AS src,
                 CASE WHEN s.currencies = 1 THEN s.amount WHEN u.currencies = 1 THEN u.amount END AS amount,
                 CASE WHEN s.currencies = 1 THEN s.currency WHEN u.currencies = 1 THEN u.currency END AS currency
        ) pr ON TRUE
        LEFT JOIN LATERAL (
          SELECT CASE
                   WHEN pr.src = 'S' THEN -s.ship
                   WHEN pr.src = 'U' AND ((u.ship IS NOT NULL AND u.ship <> 0) OR u.any_actual) THEN -COALESCE(u.ship, 0)
                   WHEN pr.src = 'U' AND UPPER(po.shipping_type) IS DISTINCT FROM ${TIKTOK_SHIPPING_TYPE} THEN NULL
                   WHEN pr.src = 'U' AND u.complete AND u.discount_known THEN -u.discount
                   WHEN pr.src = 'U' THEN ROUND(po.shipping_fee_seller_discount, 4)
                 END AS amount,
                 (pr.src = 'S' OR (u.ship IS NOT NULL AND u.ship <> 0) OR COALESCE(u.any_actual, FALSE)) AS included
        ) sh ON TRUE
        LEFT JOIN op_cost c ON c.pod_order_id = o.id
    )`;
}
