import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { tiktokAccountHandoverEventKey } from '../constants/account-handover.constants';
import { AccountHandoverAmountChangedException } from '../exceptions/account-handover-amount-changed.exception';
import { EmployeeNotFoundException } from '../exceptions/employee-not-found.exception';
import { AccountHandoverService } from './account-handover.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const EMPLOYEE = '22222222-2222-2222-2222-222222222222';
const ACCOUNT = '33333333-3333-3333-3333-333333333333';
const ACTOR = '44444444-4444-4444-4444-444444444444';

/** `tx` giả: khoá dòng Employee trả `balance`; sổ cái trả `inserted` (0 = event_key đã tồn tại). */
function fakeTx(balance: string | null, inserted = 1) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(balance === null ? [] : [{ amount: new Prisma.Decimal(balance) }]),
    employeeAccountHandoverTransaction: {
      createMany: jest.fn().mockResolvedValue({ count: inserted }),
      create: jest.fn().mockResolvedValue({}),
    },
    employee: { update: jest.fn().mockResolvedValue({}) },
  };
}

type FakeTx = ReturnType<typeof fakeTx>;

function firstArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown[][])[0][0] as T;
}

describe('AccountHandoverService', () => {
  let creditAmount: number;
  let tx: FakeTx;
  let prisma: { $transaction: jest.Mock };
  let service: AccountHandoverService;

  beforeEach(() => {
    creditAmount = 40;
    tx = fakeTx('0');
    prisma = { $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)) };
    const config = { get: jest.fn((_key: string, fallback: number) => creditAmount ?? fallback) };
    service = new AccountHandoverService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  });

  const credit = (client: FakeTx = tx) =>
    service.creditTiktokAccountHandover(client as unknown as Prisma.TransactionClient, {
      organizationId: ORG,
      employeeId: EMPLOYEE,
      tiktokAccountId: ACCOUNT,
      type: 'EMPLOYEE_LINK',
      actorUserId: ACTOR,
    });

  describe('creditTiktokAccountHandover', () => {
    it('cộng 40 USD: sổ cái (trước/sau, khoá sự kiện theo account) + số dư, cùng transaction', async () => {
      tx = fakeTx('40');
      const result = await credit(tx);

      expect(result).toEqual({ credited: true, balanceAfter: '80' });
      const { data, skipDuplicates } = firstArg<{
        data: Array<Record<string, unknown>>;
        skipDuplicates: boolean;
      }>(tx.employeeAccountHandoverTransaction.createMany);
      expect(skipDuplicates).toBe(true);
      expect(data[0]).toMatchObject({
        organizationId: ORG,
        employeeId: EMPLOYEE,
        tiktokAccountId: ACCOUNT,
        type: 'EMPLOYEE_LINK',
        currency: 'USD',
        eventKey: tiktokAccountHandoverEventKey(ACCOUNT),
        actorUserId: ACTOR,
      });
      expect(String(data[0].amount)).toBe('40');
      expect(String(data[0].balanceBefore)).toBe('40');
      expect(String(data[0].balanceAfter)).toBe('80');
      const update = firstArg<{ where: { id: string }; data: { accountHandoverAmount: Prisma.Decimal } }>(
        tx.employee.update,
      );
      expect(update.where.id).toBe(EMPLOYEE);
      expect(update.data.accountHandoverAmount.toString()).toBe('80');
    });

    it('🔒 khoá dòng Employee (FOR UPDATE) TRƯỚC khi đọc số dư — hai biến động đồng thời không ghi đè nhau', async () => {
      await credit();
      const sql = firstArg<Prisma.Sql>(tx.$queryRaw);
      expect(sql.sql).toMatch(/FOR UPDATE/);
      expect(sql.values).toEqual([EMPLOYEE, ORG]);
    });

    it('🔁 sự kiện đã xử lý (retry / link + assign / link lại) ⇒ sổ cái bỏ qua ⇒ KHÔNG đổi số dư', async () => {
      tx = fakeTx('40', 0);
      const result = await credit(tx);
      expect(result).toEqual({ credited: false });
      expect(tx.employee.update).not.toHaveBeenCalled();
    });

    it('Employee không còn tồn tại trong tổ chức ⇒ không ghi gì', async () => {
      tx = fakeTx(null);
      await expect(credit(tx)).resolves.toEqual({ credited: false });
      expect(tx.employeeAccountHandoverTransaction.createMany).not.toHaveBeenCalled();
    });

    it('số tiền lấy từ cấu hình (ACCOUNT_HANDOVER_CREDIT_AMOUNT); cấu hình 0 ⇒ tắt cộng', async () => {
      creditAmount = 25.5;
      await credit();
      const { data } = firstArg<{ data: Array<{ amount: Prisma.Decimal }> }>(
        tx.employeeAccountHandoverTransaction.createMany,
      );
      expect(data[0].amount.toString()).toBe('25.5');

      creditAmount = 0;
      const fresh = fakeTx('0');
      await expect(credit(fresh)).resolves.toEqual({ credited: false });
      expect(fresh.$queryRaw).not.toHaveBeenCalled();
    });

    it('lỗi DB khi ghi sổ cái ⇒ ném ra để transaction link / assign rollback (không nuốt lỗi)', async () => {
      tx.employeeAccountHandoverTransaction.createMany.mockRejectedValue(new Error('db down'));
      await expect(credit()).rejects.toThrow('db down');
      expect(tx.employee.update).not.toHaveBeenCalled();
    });
  });

  describe('setAmount (Admin chỉnh tay)', () => {
    it('ghi MANUAL_ADJUSTMENT với trước / sau / người sửa / ghi chú, rồi cập nhật số dư', async () => {
      tx = fakeTx('40');
      const result = await service.setAmount(ORG, ACTOR, EMPLOYEE, {
        amount: 25,
        expectedAmount: 40,
        note: '  trừ do account die  ',
      });

      expect(result).toBe('25');
      const row = firstArg<{ data: Record<string, unknown> }>(tx.employeeAccountHandoverTransaction.create).data;
      expect(row).toMatchObject({ type: 'MANUAL_ADJUSTMENT', actorUserId: ACTOR, note: 'trừ do account die' });
      expect(String(row.amount)).toBe('-15');
      expect(String(row.balanceBefore)).toBe('40');
      expect(String(row.balanceAfter)).toBe('25');
      expect(String(row.eventKey)).toMatch(/^MANUAL_ADJUSTMENT:/);
      expect(firstArg<{ data: { accountHandoverAmount: Prisma.Decimal } }>(tx.employee.update).data.accountHandoverAmount.toString()).toBe('25');
    });

    it('🔁 giá trị mới = số dư hiện tại (gửi lại cùng request) ⇒ không ghi gì, không 409', async () => {
      tx = fakeTx('25');
      await expect(service.setAmount(ORG, ACTOR, EMPLOYEE, { amount: 25, expectedAmount: 40 })).resolves.toBe('25');
      expect(tx.employeeAccountHandoverTransaction.create).not.toHaveBeenCalled();
      expect(tx.employee.update).not.toHaveBeenCalled();
    });

    it('🔒 số dư vừa đổi (có khoản cộng tự động sau khi mở form) ⇒ 409, không ghi đè', async () => {
      tx = fakeTx('80');
      await expect(
        service.setAmount(ORG, ACTOR, EMPLOYEE, { amount: 100, expectedAmount: 40 }),
      ).rejects.toBeInstanceOf(AccountHandoverAmountChangedException);
      expect(tx.employee.update).not.toHaveBeenCalled();
    });

    it('Employee khác tổ chức / đã xoá ⇒ 404', async () => {
      tx = fakeTx(null);
      await expect(service.setAmount(ORG, ACTOR, EMPLOYEE, { amount: 10 })).rejects.toBeInstanceOf(
        EmployeeNotFoundException,
      );
    });
  });
});
