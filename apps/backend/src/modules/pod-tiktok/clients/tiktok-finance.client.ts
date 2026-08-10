import { Injectable } from '@nestjs/common';
import {
  TIKTOK_GET_PAYMENTS_PATH,
  TIKTOK_GET_STATEMENTS_PATH,
  tiktokStatementTransactionsPath,
} from '../constants/tiktok.constants';
import { TiktokApiClient } from './tiktok-api.client';
import {
  TiktokPayment,
  TiktokPaymentsData,
  TiktokPaymentsQuery,
  TiktokStatement,
  TiktokStatementsData,
  TiktokStatementsQuery,
  TiktokStatementTransaction,
  TiktokStatementTransactionsData,
  TiktokStatementTransactionsQuery,
} from '../types/tiktok-finance.types';

/** Tham số chung: mọi Finance API đều là entity tag `Shop`. */
interface FinanceCallParams<Q> {
  /** shop_cipher (plaintext) — BẮT BUỘC. */
  shopCipher: string;
  accessToken: string;
  query: Q;
}

export interface PaymentsPage {
  payments: TiktokPayment[];
  nextPageToken?: string;
  requestId?: string;
}

export interface StatementsPage {
  statements: TiktokStatement[];
  nextPageToken?: string;
  requestId?: string;
}

export interface StatementTransactionsPage {
  transactions: TiktokStatementTransaction[];
  /** Tổng số dòng giao dịch của statement (TikTok trả ở mọi trang). */
  totalCount?: number;
  currency?: string;
  nextPageToken?: string;
  requestId?: string;
}

/**
 * TiktokFinanceClient — nhóm Finance API (Payout).
 *
 * Đây là cửa DUY NHẤT ra Finance API. Ba endpoint hợp thành một chuỗi:
 *
 *   Get Payments      → tiền thực nhận về ngân hàng (định nghĩa "Payout")
 *   Get Statements    → đối soát theo ngày, mang `payment_id` nối ngược lên Payment
 *   Get Transactions  → dòng giao dịch cấp ĐƠN trong statement (nguồn của Order Count)
 *
 * Toàn bộ là `GET` nên không có body để ký — `TiktokApiClient.callSigned` xử lý chữ ký.
 */
@Injectable()
export class TiktokFinanceClient {
  constructor(private readonly api: TiktokApiClient) {}

  /** Một trang Get Payments. */
  async getPayments(params: FinanceCallParams<TiktokPaymentsQuery>): Promise<PaymentsPage> {
    const result = await this.api.callSigned<TiktokPaymentsData>({
      path: TIKTOK_GET_PAYMENTS_PATH,
      method: 'GET',
      query: { shop_cipher: params.shopCipher, ...params.query },
      accessToken: params.accessToken,
      endpointLabel: 'GET_PAYMENTS',
    });

    return {
      payments: result.data?.payments ?? [],
      // Chuỗi rỗng cũng nghĩa là hết trang → chuẩn hoá về undefined.
      nextPageToken: result.data?.next_page_token || undefined,
      requestId: result.requestId,
    };
  }

  /** Một trang Get Statements. */
  async getStatements(params: FinanceCallParams<TiktokStatementsQuery>): Promise<StatementsPage> {
    const result = await this.api.callSigned<TiktokStatementsData>({
      path: TIKTOK_GET_STATEMENTS_PATH,
      method: 'GET',
      query: { shop_cipher: params.shopCipher, ...params.query },
      accessToken: params.accessToken,
      endpointLabel: 'GET_STATEMENTS',
    });

    return {
      statements: result.data?.statements ?? [],
      nextPageToken: result.data?.next_page_token || undefined,
      requestId: result.requestId,
    };
  }

  /** Một trang Get Transactions by Statement. `statementId` nằm trên PATH. */
  async getStatementTransactions(
    params: FinanceCallParams<TiktokStatementTransactionsQuery> & { statementId: string },
  ): Promise<StatementTransactionsPage> {
    const result = await this.api.callSigned<TiktokStatementTransactionsData>({
      path: tiktokStatementTransactionsPath(params.statementId),
      method: 'GET',
      query: { shop_cipher: params.shopCipher, ...params.query },
      accessToken: params.accessToken,
      endpointLabel: 'GET_STATEMENT_TRANSACTIONS',
    });

    return {
      transactions: result.data?.transactions ?? [],
      totalCount: result.data?.total_count,
      currency: result.data?.currency,
      nextPageToken: result.data?.next_page_token || undefined,
      requestId: result.requestId,
    };
  }
}
