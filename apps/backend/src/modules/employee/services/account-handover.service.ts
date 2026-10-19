import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmployeeAccountHandoverType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  ACCOUNT_HANDOVER_CURRENCY,
  manualAdjustmentEventKey,
  tiktokAccountHandoverEventKey,
} from '../constants/account-handover.constants';
import {
  AccountHandoverTransactionDto,
  AccountHandoverTransactionPageDto,
  UpdateAccountHandoverAmountDto,
} from '../dto/account-handover.dto';
import { AccountHandoverAmountChangedException } from '../exceptions/account-handover-amount-changed.exception';
import { EmployeeNotFoundException } from '../exceptions/employee-not-found.exception';

/** Loại khoản cộng TỰ ĐỘNG (link / assign) — điều chỉnh tay đi đường `setAmount`. */
export type AccountHandoverCreditType =
  | typeof EmployeeAccountHandoverType.EMPLOYEE_LINK
  | typeof EmployeeAccountHandoverType.ADMIN_ASSIGN;

export interface AccountHandoverCreditInput {
  organizationId: string;
  /** Employee NHẬN khoản cộng (người tự link, hoặc người được Admin giao) — không bao giờ là Admin thao tác. */
  employeeId: string;
  tiktokAccountId: string;
  type: AccountHandoverCreditType;
  actorUserId: string;
}

export interface AccountHandoverCreditResult {
  credited: boolean;
  /** Số dư sau khoản cộng (chuỗi Decimal) — chỉ khi `credited`. */
  balanceAfter?: string;
}

/**
 * AccountHandoverService — "Tiền giao account" của Employee: sổ cái + số dư.
 *
 * 🔴 Bất biến:
 *  1. Mọi biến động có ĐÚNG một dòng `employee_account_handover_transactions`, ghi CÙNG transaction với số dư
 *     `employees.account_handover_amount` ⇒ tổng và lịch sử không bao giờ lệch nhau.
 *  2. Khoản cộng tự động khoá theo `tiktokAccountHandoverEventKey` + UNIQUE(organization_id, event_key) ⇒ một
 *     account cộng tối đa MỘT lần, kể cả khi hai request chạy đồng thời (bản thứ hai `ON CONFLICT DO NOTHING`).
 *  3. Dòng `employees` bị khoá `FOR UPDATE` trước khi đọc số dư ⇒ hai biến động đồng thời không ghi đè nhau.
 *  4. Khoản cộng chạy TRONG transaction của thao tác link / assign (tham số `tx`) ⇒ thao tác thất bại / rollback
 *     thì không cộng; thao tác thành công thì chắc chắn đã cộng.
 */
@Injectable()
export class AccountHandoverService {
  private readonly logger = new Logger(AccountHandoverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Số tiền mỗi lần giao account (`ACCOUNT_HANDOVER_CREDIT_AMOUNT`, mặc định 40 USD). */
  creditAmount(): number {
    return this.config.get<number>('accountHandover.creditAmount', 40);
  }

  /**
   * Cộng "Tiền giao account" cho việc giao MỘT TikTok Account. Chạy trong transaction `tx` của nơi gọi.
   * Account đã từng sinh khoản cộng ⇒ không làm gì (`credited: false`).
   */
  async creditTiktokAccountHandover(
    tx: Prisma.TransactionClient,
    input: AccountHandoverCreditInput,
  ): Promise<AccountHandoverCreditResult> {
    const amount = new Prisma.Decimal(this.creditAmount());
    if (amount.lte(0)) return { credited: false };

    const before = await this.lockBalance(tx, input.organizationId, input.employeeId);
    if (before === null) return { credited: false };
    const after = before.plus(amount);

    const { count } = await tx.employeeAccountHandoverTransaction.createMany({
      data: [
        {
          organizationId: input.organizationId,
          employeeId: input.employeeId,
          tiktokAccountId: input.tiktokAccountId,
          type: input.type,
          amount,
          balanceBefore: before,
          balanceAfter: after,
          currency: ACCOUNT_HANDOVER_CURRENCY,
          eventKey: tiktokAccountHandoverEventKey(input.tiktokAccountId),
          actorUserId: input.actorUserId,
          createdBy: input.actorUserId,
        },
      ],
      // = ON CONFLICT DO NOTHING trên UNIQUE(organization_id, event_key): sự kiện đã xử lý ⇒ bỏ qua, không lỗi
      // (lỗi unique trong transaction Postgres sẽ làm hỏng CẢ thao tác link / assign).
      skipDuplicates: true,
    });
    if (count === 0) return { credited: false };

    await tx.employee.update({
      where: { id: input.employeeId },
      data: { accountHandoverAmount: after, updatedBy: input.actorUserId },
    });
    this.logger.log({
      module: 'employee',
      operation: 'account-handover.credit',
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      tiktokAccountId: input.tiktokAccountId,
      type: input.type,
      amount: amount.toString(),
      msg: 'Đã cộng Tiền giao account',
    });
    return { credited: true, balanceAfter: after.toString() };
  }

  /**
   * Admin đặt lại số dư (chỉnh tay). Ghi một dòng MANUAL_ADJUSTMENT (trước / sau / người sửa / ghi chú).
   *
   * - Giá trị mới = số dư hiện tại ⇒ không ghi gì (gửi lại cùng request là vô hại).
   * - `expectedAmount` (số người dùng đang thấy) khác số dư thật ⇒ 409, không ghi đè khoản vừa được cộng.
   */
  async setAmount(
    organizationId: string,
    actorUserId: string,
    employeeId: string,
    dto: UpdateAccountHandoverAmountDto,
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lockBalance(tx, organizationId, employeeId);
      if (before === null) throw new EmployeeNotFoundException();

      const next = new Prisma.Decimal(dto.amount);
      if (next.eq(before)) return before.toString();
      if (dto.expectedAmount !== undefined && !before.eq(dto.expectedAmount)) {
        throw new AccountHandoverAmountChangedException();
      }

      await tx.employeeAccountHandoverTransaction.create({
        data: {
          organizationId,
          employeeId,
          type: EmployeeAccountHandoverType.MANUAL_ADJUSTMENT,
          amount: next.minus(before),
          balanceBefore: before,
          balanceAfter: next,
          currency: ACCOUNT_HANDOVER_CURRENCY,
          eventKey: manualAdjustmentEventKey(randomUUID()),
          actorUserId,
          note: dto.note?.trim() || null,
          createdBy: actorUserId,
        },
      });
      await tx.employee.update({
        where: { id: employeeId },
        data: { accountHandoverAmount: next, updatedBy: actorUserId },
      });
      this.logger.log({
        module: 'employee',
        operation: 'account-handover.manual-adjust',
        organizationId,
        employeeId,
        before: before.toString(),
        after: next.toString(),
        actorUserId,
        msg: 'Đã chỉnh tay Tiền giao account',
      });
      return next.toString();
    });
  }

  /** Lịch sử biến động (mới nhất trước) — tenant-scoped. */
  async listTransactions(
    organizationId: string,
    employeeId: string,
    page: number,
    limit: number,
  ): Promise<AccountHandoverTransactionPageDto> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new EmployeeNotFoundException();

    const where: Prisma.EmployeeAccountHandoverTransactionWhereInput = {
      organizationId,
      employeeId,
      deletedAt: null,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employeeAccountHandoverTransaction.findMany({
        where,
        include: { tiktokAccount: { select: { accountName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.employeeAccountHandoverTransaction.count({ where }),
    ]);

    const actorIds = [...new Set(rows.map((row) => row.actorUserId).filter((id): id is string => !!id))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds }, organizationId },
          select: { id: true, fullName: true, email: true },
        })
      : [];
    const actorName = new Map(actors.map((user) => [user.id, user.fullName || user.email]));

    return {
      items: rows.map(
        (row): AccountHandoverTransactionDto => ({
          id: row.id,
          type: row.type,
          amount: Number(row.amount),
          balanceBefore: Number(row.balanceBefore),
          balanceAfter: Number(row.balanceAfter),
          currency: row.currency,
          tiktokAccountId: row.tiktokAccountId,
          tiktokAccountName: row.tiktokAccount?.accountName ?? null,
          actorName: row.actorUserId ? (actorName.get(row.actorUserId) ?? null) : null,
          note: row.note,
          createdAt: row.createdAt.toISOString(),
        }),
      ),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  /** Khoá dòng Employee (FOR UPDATE) và đọc số dư. `null` = không tồn tại trong tổ chức / đã xoá. */
  private async lockBalance(
    tx: Prisma.TransactionClient,
    organizationId: string,
    employeeId: string,
  ): Promise<Prisma.Decimal | null> {
    const rows = await tx.$queryRaw<Array<{ amount: Prisma.Decimal }>>(Prisma.sql`
      SELECT account_handover_amount AS amount
        FROM employees
       WHERE id = ${employeeId}::uuid AND organization_id = ${organizationId}::uuid AND deleted_at IS NULL
       FOR UPDATE`);
    return rows.length ? new Prisma.Decimal(rows[0].amount) : null;
  }
}
