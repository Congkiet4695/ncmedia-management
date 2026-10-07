/**
 * Tài chính của MỘT đơn POD cho cột "Giá": Tiền thu về · Giá vốn · Phí ship Seller · Label · Lợi nhuận · Margin.
 *
 * 🔴 Hàm THUẦN — không truy vấn, không Nest — để mọi nhánh kiểm được bằng unit test. Bản SQL CÙNG công
 * thức (Thống kê nhân viên, Dashboard): `order-profit.sql.ts` — sửa một bên phải sửa bên kia.
 *
 * Định nghĩa (chỉ dùng field chính thức của TikTok Finance 202501 / 202507, không tự suy):
 *  - **Tiền thu về** (proceeds):
 *      · đơn ĐÃ quyết toán ⇒ Σ `settlement_amount` của giao dịch `ORDER` (Get Transactions by Statement);
 *      · CHƯA quyết toán   ⇒ `est_settlement_amount` (Get Unsettled Transactions 202507) — "ƯỚC TÍNH".
 *    Có giao dịch settled thì settled THẮNG (số thật thay số ước tính).
 *  - **Giá vốn** = product cost của lần fulfill ĐANG giữ đơn ở xưởng (không gồm phí ship nhà cung cấp).
 *  - **Phí ship Seller** — phần phí vận chuyển Seller THỰC SỰ chịu (xem `resolveSellerShipping`).
 *  - **Label** = chi phí label cấu hình (`ORDER_LABEL_COST`), MỘT lần cho MỖI ĐƠN.
 *  - **Lợi nhuận** = tiền thu về − giá vốn − phí ship Seller CHƯA nằm trong tiền thu về − label.
 *  - **Margin** = lợi nhuận ÷ tiền thu về, chỉ khi tiền thu về > 0.
 *
 * 🔴 Vì sao "phí ship CHƯA nằm trong tiền thu về" (quyết định PO 2026-10-08): TikTok định nghĩa
 * `settlement_amount = revenue_amount − shipping_cost_amount − fee_and_tax_amount` (dấu theo dữ liệu: chi phí là
 * số âm). Khi TikTok ĐÃ tính phí ship (đơn đã quyết toán, hoặc ước tính có `actual_shipping_fee_amount ≠ 0`),
 * tiền thu về đã trừ sẵn phí ship — trừ thêm lần nữa là đếm hai lần. Khi CHƯA tính (ước tính, ship trả sau
 * bằng label TikTok), Seller vẫn chịu khoản `seller_shipping_fee_discount_amount` (free ship do Seller tài trợ)
 * mà ước tính chưa trừ — "Shipping fee after discounts = $0" KHÔNG có nghĩa là Seller chịu $0.
 *
 * Không đủ dữ kiện ⇒ `profit = null` kèm `status` nói rõ THIẾU GÌ — không bao giờ lấp bằng 0.
 */

/** `shipping_type` của đơn TikTok: giao bằng label của TikTok (TikTok tính phí ship cho Seller). */
export const TIKTOK_SHIPPING_TYPE = 'TIKTOK';

/** Một giao dịch tài chính của đơn (settled hoặc unsettled), số tiền đã quy về `number`. */
export interface FinanceTransactionInput {
  currency: string;
  settlementAmount: number | null;
  revenueAmount: number | null;
  feeTaxAmount: number | null;
  shippingCostAmount: number | null;
  adjustmentAmount: number | null;
  revenueBreakdown: unknown;
  feeTaxBreakdown: unknown;
  shippingCostBreakdown: unknown;
  estimatedSettlement?: string | null;
  unsettledReason?: string | null;
}

/** Chi phí label cấu hình — MỘT lần mỗi đơn. */
export interface LabelCostConfig {
  amount: number;
  currency: string;
}

/** Dữ kiện vận chuyển lấy từ Get Order Detail (nguồn dự phòng khi giao dịch chưa có breakdown). */
export interface OrderShippingInput {
  /** `shipping_type` (TIKTOK / SELLER). */
  shippingType: string | null;
  /** `payment.shipping_fee_seller_discount` — free ship do Seller tài trợ (số dương). */
  sellerShippingDiscount: number | null;
}

export interface OrderFinancialsInput {
  /** Giao dịch `ORDER` đã quyết toán của đơn. */
  settled: FinanceTransactionInput[];
  /** Giao dịch `ORDER` CHƯA quyết toán của đơn. */
  unsettled: FinanceTransactionInput[];
  /** Giá vốn của lần fulfill đang hiệu lực (null = chưa fulfill / đã huỷ). */
  cost: {
    productCost: number | null;
    productCostConfirmed: boolean;
    currency: string | null;
    fulfilledBy: string | null;
  } | null;
  shipping: OrderShippingInput;
  labelCost: LabelCostConfig;
}

export type OrderFinancialsStatus =
  /** Đủ dữ kiện, đã tính lợi nhuận. */
  | 'OK'
  /** TikTok chưa có dữ liệu quyết toán / ước tính cho đơn. */
  | 'NO_PROCEEDS'
  /** Đơn chưa được fulfill (hoặc lần fulfill đã huỷ) ⇒ chưa có giá vốn. */
  | 'NO_COST'
  /** Đã fulfill nhưng nhà cung cấp chưa xác nhận giá vốn. */
  | 'COST_PENDING'
  /** Không biết giá vốn tính bằng tiền gì (catalog nhà cung cấp không nêu). */
  | 'COST_CURRENCY_UNKNOWN'
  /** Tiền thu về và giá vốn khác đơn vị tiền — không trừ được. */
  | 'CURRENCY_MISMATCH'
  /** Chưa xác định được phí ship Seller chịu (TikTok chưa trả đủ dữ liệu / đơn tự vận chuyển). */
  | 'SHIPPING_UNKNOWN'
  /** Label cost chỉ cấu hình cho một đơn vị tiền khác tiền thu về — không quy đổi. */
  | 'LABEL_CURRENCY_MISMATCH';

/**
 * Nguồn của phí ship Seller:
 *  - `SETTLEMENT`               — đơn đã quyết toán: −Σ `shipping_cost_amount` (đã nằm trong tiền thu về);
 *  - `TIKTOK_CHARGED`           — ước tính, TikTok ĐÃ tính phí ship: −Σ `est_shipping_cost_amount` (đã nằm trong);
 *  - `SELLER_SHIPPING_DISCOUNT` — ước tính, TikTok CHƯA tính: −Σ `supplementary_component.seller_shipping_fee_discount_amount`;
 *  - `ORDER_DETAIL`             — như trên nhưng giao dịch không có breakdown: `payment.shipping_fee_seller_discount`.
 */
export type SellerShippingSource =
  | 'SETTLEMENT'
  | 'TIKTOK_CHARGED'
  | 'SELLER_SHIPPING_DISCOUNT'
  | 'ORDER_DETAIL';

export interface SellerShipping {
  /** Số Seller chịu (dương = chi phí). */
  amount: number;
  /** `true` ⇒ TikTok đã trừ trong tiền thu về — KHÔNG trừ lại vào lợi nhuận. */
  includedInProceeds: boolean;
  source: SellerShippingSource;
}

export interface OrderProceeds {
  source: 'SETTLED' | 'ESTIMATED';
  currency: string;
  amount: number;
  revenueAmount: number | null;
  feeTaxAmount: number | null;
  shippingCostAmount: number | null;
  adjustmentAmount: number | null;
  /** Breakdown nguyên văn TikTok — chỉ khi đơn có ĐÚNG MỘT giao dịch (nhiều ⇒ không gộp tự chế). */
  revenueBreakdown: unknown;
  feeTaxBreakdown: unknown;
  shippingCostBreakdown: unknown;
  transactionCount: number;
  estimatedSettlement: string | null;
  unsettledReason: string | null;
}

export interface OrderFinancials {
  proceeds: OrderProceeds | null;
  productCost: number | null;
  productCostConfirmed: boolean;
  costCurrency: string | null;
  fulfilledBy: string | null;
  /** `null` = chưa xác định (KHÔNG phải 0). */
  sellerShipping: SellerShipping | null;
  labelCost: number;
  labelCostCurrency: string;
  profit: number | null;
  /** Tỉ lệ (0.25 = 25%). */
  margin: number | null;
  status: OrderFinancialsStatus;
}

export function calculateOrderFinancials(input: OrderFinancialsInput): OrderFinancials {
  const settled = priced(input.settled);
  const unsettled = priced(input.unsettled);
  const settledProceeds = proceedsOf(settled, 'SETTLED');
  const proceeds = settledProceeds ?? proceedsOf(unsettled, 'ESTIMATED');
  const cost = input.cost;
  const sellerShipping = proceeds
    ? resolveSellerShipping(proceeds.source === 'SETTLED' ? settled : unsettled, proceeds.source, input.shipping)
    : null;
  const base = {
    proceeds,
    productCost: cost?.productCost ?? null,
    productCostConfirmed: cost?.productCostConfirmed ?? false,
    costCurrency: cost?.currency ?? null,
    fulfilledBy: cost?.fulfilledBy ?? null,
    sellerShipping,
    labelCost: input.labelCost.amount,
    labelCostCurrency: input.labelCost.currency,
  };

  const fail = (status: OrderFinancialsStatus): OrderFinancials => ({
    ...base,
    profit: null,
    margin: null,
    status,
  });

  if (!proceeds) return fail('NO_PROCEEDS');
  if (!cost || cost.productCost === null) return fail('NO_COST');
  if (!cost.productCostConfirmed) return fail('COST_PENDING');
  if (!cost.currency) return fail('COST_CURRENCY_UNKNOWN');
  if (cost.currency.toUpperCase() !== proceeds.currency.toUpperCase()) {
    return fail('CURRENCY_MISMATCH');
  }
  if (!sellerShipping) return fail('SHIPPING_UNKNOWN');
  if (input.labelCost.currency.toUpperCase() !== proceeds.currency.toUpperCase()) {
    return fail('LABEL_CURRENCY_MISMATCH');
  }

  const shippingNotInProceeds = sellerShipping.includedInProceeds ? 0 : sellerShipping.amount;
  const profit = round(proceeds.amount - cost.productCost - shippingNotInProceeds - input.labelCost.amount);
  return {
    ...base,
    profit,
    margin: proceeds.amount > 0 ? round(profit / proceeds.amount) : null,
    status: 'OK',
  };
}

/**
 * Phí ship Seller THỰC SỰ chịu, từ giao dịch tạo ra tiền thu về.
 *
 * ```
 *   SETTLED    ⇒ −Σ shipping_cost_amount                         (đã trong settlement) · thiếu ⇒ null
 *   ESTIMATED  ⇒ TikTok đã tính (actual_shipping_fee_amount ≠ 0 hoặc est_shipping_cost_amount ≠ 0)
 *                   ⇒ −Σ est_shipping_cost_amount                (đã trong ước tính)
 *                TikTok chưa tính, đơn giao bằng label TikTok
 *                   ⇒ −Σ seller_shipping_fee_discount_amount      (CHƯA trong ước tính)
 *                   ⇒ breakdown thiếu: payment.shipping_fee_seller_discount (Get Order Detail)
 *                đơn tự vận chuyển (SELLER) / không có dữ kiện ⇒ null
 * ```
 *
 * 🔴 Không suy bằng "phí ship trước giảm − sau giảm": phần chênh có thể do TikTok tài trợ
 * (`platform_shipping_fee_discount_amount`, `shipping_fee_subsidy_amount`) — Seller không chịu phần đó.
 */
export function resolveSellerShipping(
  transactions: FinanceTransactionInput[],
  source: OrderProceeds['source'],
  shipping: OrderShippingInput,
): SellerShipping | null {
  const shippingCost = sum(transactions, 'shippingCostAmount');
  if (source === 'SETTLED') {
    return shippingCost === null
      ? null
      : { amount: negate(shippingCost), includedInProceeds: true, source: 'SETTLEMENT' };
  }

  const breakdowns = transactions.map((transaction) => asRecord(transaction.shippingCostBreakdown));
  const complete = breakdowns.length > 0 && breakdowns.every((breakdown) => breakdown !== null);
  const charged =
    (shippingCost !== null && shippingCost !== 0) ||
    breakdowns.some((breakdown) => (amountOf(breakdown?.actual_shipping_fee_amount) ?? 0) !== 0);
  if (charged) {
    return { amount: negate(shippingCost ?? 0), includedInProceeds: true, source: 'TIKTOK_CHARGED' };
  }

  // Chưa tính: chỉ đơn giao bằng label TikTok mới biết trước khoản Seller sẽ chịu.
  if (shipping.shippingType?.toUpperCase() !== TIKTOK_SHIPPING_TYPE) return null;

  if (complete) {
    const discounts = breakdowns.map((breakdown) =>
      amountOf(asRecord(breakdown?.supplementary_component)?.seller_shipping_fee_discount_amount),
    );
    if (discounts.every((value): value is number => value !== null)) {
      return {
        amount: negate(round(discounts.reduce((total, value) => total + value, 0))),
        includedInProceeds: false,
        source: 'SELLER_SHIPPING_DISCOUNT',
      };
    }
  }
  if (shipping.sellerShippingDiscount !== null) {
    return {
      amount: round(shipping.sellerShippingDiscount) || 0,
      includedInProceeds: false,
      source: 'ORDER_DETAIL',
    };
  }
  return null;
}

/** Giao dịch có số tiền (dòng thiếu `settlement_amount` không tham gia tiền thu về lẫn phí ship). */
function priced(transactions: FinanceTransactionInput[]): FinanceTransactionInput[] {
  return transactions.filter((transaction) => transaction.settlementAmount !== null);
}

function proceedsOf(
  transactions: FinanceTransactionInput[],
  source: OrderProceeds['source'],
): OrderProceeds | null {
  if (transactions.length === 0) return null;
  const currencies = new Set(transactions.map((transaction) => transaction.currency.toUpperCase()));
  // Nhiều loại tiền trong cùng một đơn là dữ liệu bất thường — không cộng lẫn.
  if (currencies.size !== 1) return null;

  const single = transactions.length === 1 ? transactions[0] : null;
  return {
    source,
    currency: transactions[0].currency,
    amount: round(sum(transactions, 'settlementAmount') ?? 0),
    revenueAmount: sum(transactions, 'revenueAmount'),
    feeTaxAmount: sum(transactions, 'feeTaxAmount'),
    shippingCostAmount: sum(transactions, 'shippingCostAmount'),
    adjustmentAmount: sum(transactions, 'adjustmentAmount'),
    revenueBreakdown: single?.revenueBreakdown ?? null,
    feeTaxBreakdown: single?.feeTaxBreakdown ?? null,
    shippingCostBreakdown: single?.shippingCostBreakdown ?? null,
    transactionCount: transactions.length,
    estimatedSettlement: single?.estimatedSettlement ?? null,
    unsettledReason: single?.unsettledReason ?? null,
  };
}

/** Tổng một trường; mọi dòng đều thiếu ⇒ null (không ép 0). */
function sum(
  rows: FinanceTransactionInput[],
  field: 'settlementAmount' | 'revenueAmount' | 'feeTaxAmount' | 'shippingCostAmount' | 'adjustmentAmount',
): number | null {
  const values = rows.map((row) => row[field]).filter((value): value is number => value !== null);
  return values.length === 0 ? null : round(values.reduce((total, value) => total + value, 0));
}

/** Breakdown JSON của TikTok (khoá snake_case, số tiền dạng chuỗi). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function amountOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Chi phí TikTok là số âm ⇒ phí Seller chịu là số dương (không để lại −0). */
function negate(value: number): number {
  return round(-value) || 0;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
