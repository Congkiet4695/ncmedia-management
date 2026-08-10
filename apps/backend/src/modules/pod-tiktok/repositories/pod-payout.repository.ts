import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  MappedPayment,
  MappedStatement,
  MappedStatementTransaction,
} from '../mappers/pod-payout.mapper';

/** Ngữ cảnh tenant + nguồn ghi của một lần đồng bộ payout. */
export interface PayoutWriteContext {
  organizationId: string;
  accountId: string;
  shopId: string;
}

/** Statement cần kéo giao dịch cấp đơn. */
export interface StatementNeedingTransactions {
  id: string;
  tiktokStatementId: string;
  currency: string;
}

export interface UpsertCounters {
  created: number;
  updated: number;
  skipped: number;
}

/**
 * PodPayoutRepository — data access cho luồng ĐỒNG BỘ payout.
 * (Phần truy vấn báo cáo nằm ở `PodPayoutReportRepository` — tách đọc/ghi cho rõ trách nhiệm.)
 *
 * Mọi method nhận `organizationId` (tenant isolation — ADR-004).
 * Ghi idempotent theo UNIQUE `(organization_id, tiktok_*_id)`: chạy lại không tạo bản ghi trùng.
 */
@Injectable()
export class PodPayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Số payment đang có của shop — dùng để quyết định kéo toàn bộ lịch sử hay không. */
  countPayments(organizationId: string, shopId: string): Promise<number> {
    return this.prisma.podTiktokPayment.count({
      where: { organizationId, shopId, deletedAt: null },
    });
  }

  /**
   * Ghi một lô payment.
   * Bản ghi không đổi (payloadHash trùng) chỉ chạm `last_synced_at` — tránh update thừa.
   */
  async upsertPayments(
    ctx: PayoutWriteContext,
    payments: MappedPayment[],
    now: Date,
  ): Promise<UpsertCounters> {
    const counters: UpsertCounters = { created: 0, updated: 0, skipped: 0 };
    if (payments.length === 0) return counters;

    const existing = await this.prisma.podTiktokPayment.findMany({
      where: {
        organizationId: ctx.organizationId,
        tiktokPaymentId: { in: payments.map((p) => p.tiktokPaymentId) },
      },
      select: { id: true, tiktokPaymentId: true, payloadHash: true },
    });
    const byTiktokId = new Map(existing.map((row) => [row.tiktokPaymentId, row]));

    for (const payment of payments) {
      const current = byTiktokId.get(payment.tiktokPaymentId);

      if (!current) {
        await this.prisma.podTiktokPayment.create({
          data: {
            organizationId: ctx.organizationId,
            accountId: ctx.accountId,
            shopId: ctx.shopId,
            tiktokPaymentId: payment.tiktokPaymentId,
            payloadHash: payment.payloadHash,
            lastSyncedAt: now,
            ...payment.data,
          },
        });
        counters.created += 1;
        continue;
      }

      if (current.payloadHash === payment.payloadHash) {
        await this.prisma.podTiktokPayment.update({
          where: { id: current.id },
          data: { lastSyncedAt: now, deletedAt: null },
        });
        counters.skipped += 1;
        continue;
      }

      // Trạng thái đổi (vd PROCESSING → PAID) hoặc số tiền được TikTok chỉnh lại.
      await this.prisma.podTiktokPayment.update({
        where: { id: current.id },
        data: {
          payloadHash: payment.payloadHash,
          lastSyncedAt: now,
          deletedAt: null,
          ...payment.data,
        },
      });
      counters.updated += 1;
    }

    return counters;
  }

  /** Ghi một lô statement (cùng quy tắc idempotent như payment). */
  async upsertStatements(
    ctx: PayoutWriteContext,
    statements: MappedStatement[],
    now: Date,
  ): Promise<UpsertCounters> {
    const counters: UpsertCounters = { created: 0, updated: 0, skipped: 0 };
    if (statements.length === 0) return counters;

    const existing = await this.prisma.podTiktokStatement.findMany({
      where: {
        organizationId: ctx.organizationId,
        tiktokStatementId: { in: statements.map((s) => s.tiktokStatementId) },
      },
      select: { id: true, tiktokStatementId: true, payloadHash: true },
    });
    const byTiktokId = new Map(existing.map((row) => [row.tiktokStatementId, row]));

    for (const statement of statements) {
      const current = byTiktokId.get(statement.tiktokStatementId);

      if (!current) {
        await this.prisma.podTiktokStatement.create({
          data: {
            organizationId: ctx.organizationId,
            accountId: ctx.accountId,
            shopId: ctx.shopId,
            tiktokStatementId: statement.tiktokStatementId,
            payloadHash: statement.payloadHash,
            lastSyncedAt: now,
            ...statement.data,
          },
        });
        counters.created += 1;
        continue;
      }

      if (current.payloadHash === statement.payloadHash) {
        await this.prisma.podTiktokStatement.update({
          where: { id: current.id },
          data: { lastSyncedAt: now, deletedAt: null },
        });
        counters.skipped += 1;
        continue;
      }

      await this.prisma.podTiktokStatement.update({
        where: { id: current.id },
        data: {
          payloadHash: statement.payloadHash,
          lastSyncedAt: now,
          deletedAt: null,
          ...statement.data,
        },
      });
      counters.updated += 1;
    }

    return counters;
  }

  /**
   * Nối `statement.payment_id` (chuỗi TikTok) sang khoá ngoại nội bộ `payment_id`.
   *
   * Chạy SAU khi đã ghi cả payment lẫn statement: statement có thể về TRƯỚC payment
   * tương ứng, nên phép nối phải là một bước riêng và chạy lại được.
   * Trả về số dòng đã nối.
   */
  async linkStatementsToPayments(organizationId: string, shopId: string): Promise<number> {
    const result = await this.prisma.$executeRaw`
      UPDATE pod_tiktok_statements s
         SET payment_id = p.id,
             updated_at = NOW()
        FROM pod_tiktok_payments p
       WHERE s.organization_id = ${organizationId}::uuid
         AND s.shop_id = ${shopId}::uuid
         AND s.deleted_at IS NULL
         AND s.payment_id IS NULL
         AND s.tiktok_payment_id IS NOT NULL
         AND p.organization_id = s.organization_id
         AND p.tiktok_payment_id = s.tiktok_payment_id
         AND p.deleted_at IS NULL`;
    return result;
  }

  /**
   * Statement chưa kéo giao dịch cấp đơn.
   * Statement đã chốt (SETTLED) thì giao dịch bất biến ⇒ chỉ kéo MỘT lần cho mỗi statement,
   * nhờ vậy chi phí đồng bộ định kỳ gần như bằng 0 sau lần đầu.
   */
  findStatementsNeedingTransactions(
    organizationId: string,
    shopId: string,
    limit: number,
  ): Promise<StatementNeedingTransactions[]> {
    return this.prisma.podTiktokStatement.findMany({
      where: {
        organizationId,
        shopId,
        deletedAt: null,
        transactionsSyncedAt: null,
      },
      select: { id: true, tiktokStatementId: true, currency: true },
      orderBy: { statementAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Ghi toàn bộ giao dịch của MỘT statement rồi đánh dấu đã kéo xong.
   *
   * Chạy trong một transaction: hoặc statement có đủ giao dịch và được đánh dấu,
   * hoặc không đánh dấu gì để lượt sau kéo lại — không có trạng thái nửa vời.
   */
  async replaceStatementTransactions(
    ctx: PayoutWriteContext,
    statementId: string,
    transactions: MappedStatementTransaction[],
    orderCount: number,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const transaction of transactions) {
        const data = {
          organizationId: ctx.organizationId,
          accountId: ctx.accountId,
          shopId: ctx.shopId,
          statementId,
          tiktokTransactionId: transaction.tiktokTransactionId,
          ...transaction.data,
        };
        await tx.podTiktokStatementTransaction.upsert({
          where: {
            organizationId_tiktokTransactionId: {
              organizationId: ctx.organizationId,
              tiktokTransactionId: transaction.tiktokTransactionId,
            },
          },
          create: data,
          update: { ...transaction.data, statementId, deletedAt: null },
        });
      }

      await tx.podTiktokStatement.update({
        where: { id: statementId },
        data: { transactionsSyncedAt: now, orderCount },
      });
    });
  }

  /** Đánh dấu statement đã xử lý xong dù không có giao dịch nào (tránh kéo lại mãi). */
  async markTransactionsSynced(statementId: string, now: Date): Promise<void> {
    await this.prisma.podTiktokStatement.update({
      where: { id: statementId },
      data: { transactionsSyncedAt: now, orderCount: 0 },
    });
  }

  /** Tổng hợp nhanh phục vụ log/giám sát sau mỗi lượt đồng bộ. */
  async summarize(
    organizationId: string,
    shopId: string,
  ): Promise<{ payments: number; statements: number; transactions: number }> {
    const where = { organizationId, shopId, deletedAt: null };
    const [payments, statements, transactions] = await this.prisma.$transaction([
      this.prisma.podTiktokPayment.count({ where }),
      this.prisma.podTiktokStatement.count({ where }),
      this.prisma.podTiktokStatementTransaction.count({ where }),
    ]);
    return { payments, statements, transactions };
  }

  /** Prisma client cho các trường hợp cần raw query có kiểm soát. */
  get client(): Prisma.TransactionClient {
    return this.prisma;
  }
}
