/**
 * Kiểu RAW của nhóm Finance API (Payout).
 *
 * Nguồn tài liệu chính thức:
 *  - Finance API overview            (doc 650b1f13c16ffe02b8012c2e)
 *  - Get Payments                    (doc 6a27b22ba6ff06049bbbd584)
 *  - Get Statements                  (doc 650a676f0fcef602bf2b91f0)
 *  - Get Transactions by Statement   (doc 6789c0c11882810314794094)
 *
 * Tên field giữ NGUYÊN snake_case của TikTok — đây là ranh giới Anti-Corruption Layer.
 * Mọi field khai báo optional: TikTok bổ sung/bỏ field theo thị trường và theo version,
 * parser phải khoan dung ("make response deserialization tolerant").
 */

/** Cặp {value, currency} — TikTok trả số tiền dưới dạng CHUỖI để không mất độ chính xác. */
export interface TiktokMoney {
  value?: string;
  currency?: string;
}

// ---------------------------------------------------------------------------
// Get Payments
// ---------------------------------------------------------------------------

export interface TiktokPayment {
  id?: string;
  /** PROCESSING | PAID | FAILED. */
  status?: string;
  /** Thời điểm khởi tạo chi trả (Unix seconds). */
  create_time?: number;
  /** Thời điểm chi trả thành công. TikTok trả `0` khi chưa chi. */
  paid_time?: number;
  /** Số tiền chi trả cuối cùng (sau quy đổi ngoại tệ). */
  amount?: TiktokMoney;
  /** Số tiền đối soát trước quy đổi. */
  settlement_amount?: TiktokMoney;
  /** Số tiền chi trả trước quy đổi. */
  payment_amount_before_exchange?: TiktokMoney;
  /** Chỉ có ở bản 202309. */
  reserve_amount?: TiktokMoney;
  exchange_rate?: string;
  /** Đã được TikTok che, chỉ còn 4 số cuối. */
  bank_account?: string;
}

export interface TiktokPaymentsData {
  payments?: TiktokPayment[];
  next_page_token?: string;
}

export interface TiktokPaymentsQuery {
  page_size: number;
  page_token?: string;
  /** Chỉ hỗ trợ `create_time`. */
  sort_field: 'create_time';
  sort_order?: 'ASC' | 'DESC';
  create_time_ge?: number;
  create_time_lt?: number;
}

// ---------------------------------------------------------------------------
// Get Statements
// ---------------------------------------------------------------------------

export interface TiktokStatement {
  id?: string;
  /** Sinh hằng ngày lúc 00:00 UTC (Unix seconds). */
  statement_time?: number;
  settlement_amount?: string;
  currency?: string;
  revenue_amount?: string;
  fee_amount?: string;
  adjustment_amount?: string;
  /** PROCESSING | PAID | FAILED. */
  payment_status?: string;
  payment_id?: string;
  payment_time?: number;
  /** Chỉ áp dụng cho local seller ngoài SEA. */
  net_sales_amount?: string;
  shipping_cost_amount?: string;
}

export interface TiktokStatementsData {
  statements?: TiktokStatement[];
  next_page_token?: string;
}

export interface TiktokStatementsQuery {
  page_size: number;
  page_token?: string;
  /** Chỉ hỗ trợ `statement_time`. */
  sort_field: 'statement_time';
  sort_order?: 'ASC' | 'DESC';
  statement_time_ge?: number;
  statement_time_lt?: number;
  /** Lọc theo trạng thái chi trả. Bỏ trống = mọi trạng thái. */
  payment_status?: string;
}

// ---------------------------------------------------------------------------
// Get Transactions by Statement
// ---------------------------------------------------------------------------

export interface TiktokStatementTransaction {
  id?: string;
  /** ORDER | ADJUSTMENT | RESERVE (TikTok có thể bổ sung giá trị mới). */
  type?: string;
  /** Có với `type = ORDER`. */
  order_id?: string;
  order_create_time?: number;
  /** Có với giao dịch điều chỉnh. */
  adjustment_id?: string;
  adjustment_order_id?: string;
  /** Có với giao dịch giữ tiền (reserve). */
  reserve_id?: string;
  associated_order_id?: string;
  reserve_status?: string;

  settlement_amount?: string;
  revenue_amount?: string;
  fee_tax_amount?: string;
  shipping_cost_amount?: string;
  adjustment_amount?: string;
  reserve_amount?: string;

  /** Chi tiết doanh thu (Gross sales, Seller discount…) — lưu NGUYÊN VĂN. */
  revenue_breakdown?: TiktokFinanceBreakdown;
  /** `{ fee: {...}, tax: {...} }` (Referral fee, Transaction fee, Sales tax…) — lưu NGUYÊN VĂN. */
  fee_tax_breakdown?: TiktokFinanceBreakdown;
  /** Chi tiết chi phí vận chuyển (kèm `supplementary_component`) — lưu NGUYÊN VĂN. */
  shipping_cost_breakdown?: TiktokFinanceBreakdown;
}

/**
 * Một khối breakdown của Finance API: tên field → số tiền dạng CHUỖI, có thể lồng một cấp
 * (`fee_tax_breakdown.fee`, `shipping_cost_breakdown.supplementary_component`).
 *
 * 🔴 KHÔNG liệt kê cứng từng field: TikTok có hơn 50 loại phí và bổ sung liên tục. Lưu nguyên
 * văn, giao diện dịch nhãn những field đã biết và hiện tên gốc cho field mới.
 */
export type TiktokFinanceBreakdown = { [field: string]: string | TiktokFinanceBreakdown | undefined };

export interface TiktokStatementTransactionsData {
  id?: string;
  create_time?: number;
  /** Chỉ hỗ trợ `SETTLED`. */
  status?: string;
  currency?: string;
  payable_amount?: string;
  total_reserve_amount?: string;
  total_settlement_amount?: string;
  total_count?: number;
  transactions?: TiktokStatementTransaction[];
  next_page_token?: string;
}

export interface TiktokStatementTransactionsQuery {
  page_size: number;
  page_token?: string;
  /** Chỉ hỗ trợ `order_create_time`. */
  sort_field: 'order_create_time';
  sort_order?: 'ASC' | 'DESC';
}

// ---------------------------------------------------------------------------
// Get Unsettled Transactions — GET /finance/202507/orders/unsettled
// Nguồn: `Finance202507GetUnsettledTransactionsResponseData*` của SDK chính thức.
// ---------------------------------------------------------------------------

/** Một giao dịch CHƯA quyết toán (đơn hoặc điều chỉnh). Mọi số tiền là ƯỚC TÍNH. */
export interface TiktokUnsettledTransaction {
  id?: string;
  /** `ORDER` hoặc một loại điều chỉnh (CHARGE_BACK, …). */
  type?: string;
  status?: string;
  order_id?: string;
  adjustment_id?: string;
  adjustment_order_id?: string;
  currency?: string;
  /** "revenue_amount - shipping_cost_amount - fee_tax_amount - adjustment_amount" (tài liệu). */
  est_settlement_amount?: string;
  est_revenue_amount?: string;
  est_fee_tax_amount?: string;
  est_shipping_cost_amount?: string;
  est_adjustment_amount?: string;
  revenue_breakdown?: TiktokFinanceBreakdown;
  fee_tax_breakdown?: TiktokFinanceBreakdown;
  shipping_cost_breakdown?: TiktokFinanceBreakdown;
  /** "x days after delivery" hoặc Unix timestamp (chuỗi). */
  estimated_settlement?: string;
  unsettled_reason?: string;
  order_create_time?: number;
  order_delivery_time?: number;
}

export interface TiktokUnsettledTransactionsData {
  transactions?: TiktokUnsettledTransaction[];
  next_page_token?: string;
  total_count?: number;
}

export interface TiktokUnsettledTransactionsQuery {
  page_size: number;
  page_token?: string;
  /** Chỉ hỗ trợ `order_create_time` (bắt buộc). */
  sort_field: 'order_create_time';
  sort_order?: 'ASC' | 'DESC';
  search_time_ge?: number;
  search_time_lt?: number;
}
