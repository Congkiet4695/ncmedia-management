import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PodPayoutStatus, PodStatementTxType, Prisma } from '@prisma/client';
import {
  TiktokPayment,
  TiktokStatement,
  TiktokStatementTransaction,
} from '../types/tiktok-finance.types';

/** Bản ghi payment đã chuẩn hoá, sẵn sàng ghi DB. */
export interface MappedPayment {
  tiktokPaymentId: string;
  payloadHash: string;
  data: {
    status: PodPayoutStatus;
    amount: Prisma.Decimal;
    currency: string;
    settlementAmount: Prisma.Decimal | null;
    amountBeforeExchange: Prisma.Decimal | null;
    exchangeRate: Prisma.Decimal | null;
    reserveAmount: Prisma.Decimal | null;
    bankAccountMasked: string | null;
    paymentCreateTime: bigint;
    paymentCreatedAt: Date;
    paidAt: Date | null;
  };
}

/** Bản ghi statement đã chuẩn hoá. */
export interface MappedStatement {
  tiktokStatementId: string;
  payloadHash: string;
  data: {
    tiktokPaymentId: string | null;
    paymentStatus: PodPayoutStatus;
    statementTime: bigint;
    statementAt: Date;
    paidAt: Date | null;
    currency: string;
    settlementAmount: Prisma.Decimal;
    revenueAmount: Prisma.Decimal | null;
    feeAmount: Prisma.Decimal | null;
    adjustmentAmount: Prisma.Decimal | null;
    netSalesAmount: Prisma.Decimal | null;
    shippingCostAmount: Prisma.Decimal | null;
  };
}

/** Dòng giao dịch đã chuẩn hoá. */
export interface MappedStatementTransaction {
  tiktokTransactionId: string;
  data: {
    type: PodStatementTxType;
    tiktokOrderId: string | null;
    adjustmentId: string | null;
    reserveId: string | null;
    orderCreateTime: bigint | null;
    currency: string;
    settlementAmount: Prisma.Decimal;
    revenueAmount: Prisma.Decimal | null;
    feeTaxAmount: Prisma.Decimal | null;
    shippingCostAmount: Prisma.Decimal | null;
    adjustmentAmount: Prisma.Decimal | null;
    reserveAmount: Prisma.Decimal | null;
  };
}

/**
 * PodPayoutMapper — Anti-Corruption Layer cho Finance API.
 *
 * Nguyên tắc:
 *  - 🔴 KHÔNG tính lại tiền. Số tiền là chuỗi TikTok trả về, chỉ parse sang `Decimal`
 *    (không dùng `parseFloat` — mất độ chính xác với tiền tệ).
 *  - Trạng thái lạ ⇒ trả `null` để service BỎ QUA bản ghi và ghi log, thay vì đoán bừa
 *    (cùng nguyên tắc với order status — xem 07-risks §R3.6).
 *  - `payloadHash` cho phép bỏ qua ghi đè khi TikTok trả lại y nguyên dữ liệu cũ.
 */
@Injectable()
export class PodPayoutMapper {
  private readonly logger = new Logger(PodPayoutMapper.name);

  /** Đơn vị tiền tệ dự phòng khi TikTok bỏ trống (không để rỗng làm vỡ CHECK constraint). */
  private static readonly UNKNOWN_CURRENCY = 'UNK';

  mapPayment(payment: TiktokPayment): MappedPayment | null {
    const id = payment.id?.trim();
    const status = this.toPayoutStatus(payment.status);
    if (!id || !status) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'payout.map',
        tiktokPaymentId: payment.id,
        status: payment.status,
        msg: 'Bỏ qua payment thiếu id hoặc có trạng thái không nhận diện được',
      });
      return null;
    }

    const createTime = payment.create_time ?? 0;
    return {
      tiktokPaymentId: id,
      payloadHash: this.hash(payment),
      data: {
        status,
        amount: this.toDecimal(payment.amount?.value) ?? new Prisma.Decimal(0),
        currency: payment.amount?.currency ?? PodPayoutMapper.UNKNOWN_CURRENCY,
        settlementAmount: this.toDecimal(payment.settlement_amount?.value),
        amountBeforeExchange: this.toDecimal(payment.payment_amount_before_exchange?.value),
        exchangeRate: this.toDecimal(payment.exchange_rate),
        reserveAmount: this.toDecimal(payment.reserve_amount?.value),
        bankAccountMasked: payment.bank_account?.slice(0, 64) ?? null,
        paymentCreateTime: BigInt(createTime),
        paymentCreatedAt: this.toDate(createTime) ?? new Date(0),
        paidAt: this.toDate(payment.paid_time),
      },
    };
  }

  mapStatement(statement: TiktokStatement): MappedStatement | null {
    const id = statement.id?.trim();
    const status = this.toPayoutStatus(statement.payment_status);
    if (!id || !status) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'payout.map',
        tiktokStatementId: statement.id,
        paymentStatus: statement.payment_status,
        msg: 'Bỏ qua statement thiếu id hoặc có trạng thái không nhận diện được',
      });
      return null;
    }

    const statementTime = statement.statement_time ?? 0;
    return {
      tiktokStatementId: id,
      payloadHash: this.hash(statement),
      data: {
        tiktokPaymentId: statement.payment_id?.trim() || null,
        paymentStatus: status,
        statementTime: BigInt(statementTime),
        statementAt: this.toDate(statementTime) ?? new Date(0),
        paidAt: this.toDate(statement.payment_time),
        currency: statement.currency ?? PodPayoutMapper.UNKNOWN_CURRENCY,
        settlementAmount: this.toDecimal(statement.settlement_amount) ?? new Prisma.Decimal(0),
        revenueAmount: this.toDecimal(statement.revenue_amount),
        feeAmount: this.toDecimal(statement.fee_amount),
        adjustmentAmount: this.toDecimal(statement.adjustment_amount),
        netSalesAmount: this.toDecimal(statement.net_sales_amount),
        shippingCostAmount: this.toDecimal(statement.shipping_cost_amount),
      },
    };
  }

  /**
   * Chuẩn hoá một dòng giao dịch.
   * `currency` không có ở cấp dòng — lấy từ cấp statement (TikTok trả một lần cho cả trang).
   */
  mapStatementTransaction(
    transaction: TiktokStatementTransaction,
    currency: string,
  ): MappedStatementTransaction | null {
    const id = transaction.id?.trim();
    if (!id) return null;

    return {
      tiktokTransactionId: id,
      data: {
        type: this.toTransactionType(transaction.type),
        // Thứ tự ưu tiên theo tài liệu: dòng ORDER có `order_id`; điều chỉnh có
        // `adjustment_order_id`; reserve có `associated_order_id`.
        tiktokOrderId:
          transaction.order_id?.trim() ||
          transaction.adjustment_order_id?.trim() ||
          transaction.associated_order_id?.trim() ||
          null,
        adjustmentId: transaction.adjustment_id?.trim() || null,
        reserveId: transaction.reserve_id?.trim() || null,
        orderCreateTime:
          transaction.order_create_time !== undefined && transaction.order_create_time !== null
            ? BigInt(transaction.order_create_time)
            : null,
        currency: currency || PodPayoutMapper.UNKNOWN_CURRENCY,
        settlementAmount: this.toDecimal(transaction.settlement_amount) ?? new Prisma.Decimal(0),
        revenueAmount: this.toDecimal(transaction.revenue_amount),
        feeTaxAmount: this.toDecimal(transaction.fee_tax_amount),
        shippingCostAmount: this.toDecimal(transaction.shipping_cost_amount),
        adjustmentAmount: this.toDecimal(transaction.adjustment_amount),
        reserveAmount: this.toDecimal(transaction.reserve_amount),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Trạng thái chi trả. TikTok chỉ định nghĩa PROCESSING | PAID | FAILED.
   * Giá trị lạ ⇒ `null` (service bỏ qua bản ghi + log) — thà thiếu còn hơn thống kê sai.
   */
  private toPayoutStatus(value?: string): PodPayoutStatus | null {
    switch (value?.toUpperCase()) {
      case 'PROCESSING':
        return PodPayoutStatus.PROCESSING;
      case 'PAID':
        return PodPayoutStatus.PAID;
      case 'FAILED':
        return PodPayoutStatus.FAILED;
      default:
        return null;
    }
  }

  /** Loại giao dịch. Giá trị lạ ⇒ `OTHER` (giữ được bản ghi mà không vỡ enum DB). */
  private toTransactionType(value?: string): PodStatementTxType {
    switch (value?.toUpperCase()) {
      case 'ORDER':
        return PodStatementTxType.ORDER;
      case 'ADJUSTMENT':
        return PodStatementTxType.ADJUSTMENT;
      case 'RESERVE':
        return PodStatementTxType.RESERVE;
      default:
        return PodStatementTxType.OTHER;
    }
  }

  /** Tiền: TikTok trả STRING. Rỗng/không hợp lệ → null (KHÔNG ép về 0). */
  private toDecimal(value?: string | null): Prisma.Decimal | null {
    if (value === undefined || value === null || value === '') return null;
    if (!Number.isFinite(Number(value))) return null;
    return new Prisma.Decimal(value);
  }

  /** Unix seconds → Date. TikTok dùng `0` để biểu thị "chưa xảy ra". */
  private toDate(seconds?: number | null): Date | null {
    if (seconds === undefined || seconds === null || seconds <= 0) return null;
    return new Date(seconds * 1000);
  }

  /** sha256 canonical (sắp xếp key đệ quy) — phát hiện thay đổi NỘI DUNG. */
  private hash(value: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(this.sortDeep(value)), 'utf8')
      .digest('hex');
  }

  private sortDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sortDeep(item));
    if (value === null || typeof value !== 'object') return value;
    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        if (source[key] !== undefined) acc[key] = this.sortDeep(source[key]);
        return acc;
      }, {});
  }
}
