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
}

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
