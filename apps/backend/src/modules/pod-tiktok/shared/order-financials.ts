/**
 * Tài chính của MỘT đơn POD cho cột "Giá": Tiền thu về · Giá vốn · Lợi nhuận · Margin.
 *
 * 🔴 Hàm THUẦN — không truy vấn, không Nest — để mọi nhánh kiểm được bằng unit test.
 *
 * Định nghĩa (không tự suy công thức tài chính — chỉ dùng field chính thức):
 *  - **Tiền thu về** (proceeds):
 *      · đơn ĐÃ quyết toán ⇒ Σ \`settlement_amount\` của giao dịch \`ORDER\` (Get Transactions by Statement);
 *      · CHƯA quyết toán   ⇒ \`est_settlement_amount\` (Get Unsettled Transactions 202507) — "ƯỚC TÍNH".
 *    Có giao dịch settled thì settled THẮNG (số thật thay số ước tính).
 *  - **Giá vốn** = product cost của lần fulfill ĐANG giữ đơn ở xưởng (quyết định PO: chỉ product cost,
 *    không gồm phí ship của nhà cung cấp) — xem \`fulfillment/shared/product-cost.ts\`.
 *  - **Lợi nhuận** = tiền thu về − giá vốn.
 *  - **Margin** = lợi nhuận ÷ tiền thu về (quyết định PO), chỉ khi tiền thu về > 0.
 *
 * Không đủ dữ kiện ⇒ \`profit = null\` kèm \`status\` nói rõ THIẾU GÌ — không bao giờ lấp bằng 0.
 */

/** Một giao dịch tài chính của đơn (settled hoặc unsettled), số tiền đã quy về \`number\`. */
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

export interface OrderFinancialsInput {
  /** Giao dịch \`ORDER\` đã quyết toán của đơn. */
  settled: FinanceTransactionInput[];
  /** Giao dịch \`ORDER\` CHƯA quyết toán của đơn. */
  unsettled: FinanceTransactionInput[];
  /** Giá vốn của lần fulfill đang hiệu lực (null = chưa fulfill / đã huỷ). */
  cost: {
    productCost: number | null;
    productCostConfirmed: boolean;
    currency: string | null;
    fulfilledBy: string | null;
  } | null;
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
  | 'CURRENCY_MISMATCH';

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
  profit: number | null;
  /** Tỉ lệ (0.25 = 25%). */
  margin: number | null;
  status: OrderFinancialsStatus;
}

export function calculateOrderFinancials(input: OrderFinancialsInput): OrderFinancials {
  const proceeds =
    proceedsOf(input.settled, 'SETTLED') ?? proceedsOf(input.unsettled, 'ESTIMATED');
  const cost = input.cost;
  const base = {
    proceeds,
    productCost: cost?.productCost ?? null,
    productCostConfirmed: cost?.productCostConfirmed ?? false,
    costCurrency: cost?.currency ?? null,
    fulfilledBy: cost?.fulfilledBy ?? null,
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

  const profit = round(proceeds.amount - cost.productCost);
  return {
    ...base,
    profit,
    margin: proceeds.amount > 0 ? round(profit / proceeds.amount) : null,
    status: 'OK',
  };
}

function proceedsOf(
  transactions: FinanceTransactionInput[],
  source: OrderProceeds['source'],
): OrderProceeds | null {
  const priced = transactions.filter((transaction) => transaction.settlementAmount !== null);
  if (priced.length === 0) return null;
  const currencies = new Set(priced.map((transaction) => transaction.currency.toUpperCase()));
  // Nhiều loại tiền trong cùng một đơn là dữ liệu bất thường — không cộng lẫn.
  if (currencies.size !== 1) return null;

  const single = priced.length === 1 ? priced[0] : null;
  return {
    source,
    currency: priced[0].currency,
    amount: round(sum(priced, 'settlementAmount') ?? 0),
    revenueAmount: sum(priced, 'revenueAmount'),
    feeTaxAmount: sum(priced, 'feeTaxAmount'),
    shippingCostAmount: sum(priced, 'shippingCostAmount'),
    adjustmentAmount: sum(priced, 'adjustmentAmount'),
    revenueBreakdown: single?.revenueBreakdown ?? null,
    feeTaxBreakdown: single?.feeTaxBreakdown ?? null,
    shippingCostBreakdown: single?.shippingCostBreakdown ?? null,
    transactionCount: priced.length,
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

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
