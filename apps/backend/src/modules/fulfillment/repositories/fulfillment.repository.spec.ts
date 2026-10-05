import { FulfillmentStatus } from '@prisma/client';
import { callArg } from '../../../testing/mock-call.util';
import { PrismaService } from '../../../database/prisma.service';
import { FulfillmentRepository } from './fulfillment.repository';

/**
 * Chỉ kiểm tra ĐIỀU KIỆN LỌC của truy vấn lấy đơn cần hỏi trạng thái.
 *
 * Đây là phần quyết định scheduler bỏ sót đơn nào — sai một trạng thái là đơn kẹt vĩnh viễn
 * mà không có lỗi nào được ném ra, nên phải chốt bằng test thay vì đọc mắt.
 */
describe('FulfillmentRepository.findOrdersToSync', () => {
  function build() {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { fulfillmentOrder: { findMany } } as unknown as PrismaService;
    return { repo: new FulfillmentRepository(prisma), findMany };
  }

  type Branch = {
    status?: FulfillmentStatus | { in: FulfillmentStatus[] };
    providerOrderId?: unknown;
    submittedAt?: unknown;
    updatedAt?: { lt: Date };
  };
  const branchesOf = (findMany: jest.Mock) =>
    callArg<{ where: { OR: Branch[]; deletedAt: unknown } }>(findMany, 0, 0).where;

  it('nhánh thường: chỉ đơn ĐANG BAY có mã nhà cung cấp, không lấy đơn đã kết thúc', async () => {
    const { repo, findMany } = build();

    await repo.findOrdersToSync(50);

    const live = branchesOf(findMany).OR[0];
    expect(live.providerOrderId).toEqual({ not: null });
    const statuses = (live.status as { in: FulfillmentStatus[] }).in;
    expect(statuses).toEqual(
      expect.arrayContaining([
        // Tiến trình chết giữa lúc gửi ⇒ phải hỏi lại, nếu không bản ghi kẹt mãi ở SUBMITTING.
        FulfillmentStatus.SUBMITTING,
        FulfillmentStatus.SUBMITTED,
        FulfillmentStatus.IN_PRODUCTION,
        FulfillmentStatus.ON_HOLD,
        FulfillmentStatus.SHIPPED,
        FulfillmentStatus.UNKNOWN,
      ]),
    );
    // Trạng thái kết thúc thì hỏi lại chỉ tốn quota vô ích.
    for (const terminal of [
      FulfillmentStatus.DRAFT,
      FulfillmentStatus.DELIVERED,
      FulfillmentStatus.CANCELLED,
      FulfillmentStatus.REJECTED,
      FulfillmentStatus.REFUNDED,
      FulfillmentStatus.FAILED,
    ]) {
      expect(statuses).not.toContain(terminal);
    }
  });

  it('🔴 đối soát: SUBMITTING không rõ kết quả (kể cả CHƯA có mã) sau 2 phút được tra lại', async () => {
    const { repo, findMany } = build();
    const now = new Date('2026-10-06T10:00:00Z');

    await repo.findOrdersToSync(50, undefined, now);

    const pending = branchesOf(findMany).OR[1];
    expect(pending).toEqual({
      status: FulfillmentStatus.SUBMITTING,
      updatedAt: { lt: new Date('2026-10-06T09:58:00Z') },
    });
  });

  it('🔴 đối soát: FAILED nhưng ĐÃ có mã nhà cung cấp + mốc gửi (bị hạ sai) được tra lại để khôi phục', async () => {
    const { repo, findMany } = build();

    const now = new Date('2026-10-06T10:00:00Z');
    await repo.findOrdersToSync(50, undefined, now);

    // Chỉ trong 30 ngày kể từ mốc gửi — quá hạn mà nhà cung cấp vẫn không trả được đơn thì thôi hỏi.
    expect(branchesOf(findMany).OR[2]).toEqual({
      status: FulfillmentStatus.FAILED,
      providerOrderId: { not: null },
      submittedAt: { gte: new Date('2026-09-06T10:00:00Z') },
    });
  });

  it('bỏ qua đơn đã xoá mềm', async () => {
    const { repo, findMany } = build();

    await repo.findOrdersToSync(50);

    expect(branchesOf(findMany).deletedAt).toBeNull();
  });

  it('ưu tiên đơn lâu chưa đồng bộ nhất và tôn trọng giới hạn lô', async () => {
    const { repo, findMany } = build();

    await repo.findOrdersToSync(25);

    const args = callArg<{
      orderBy: { lastSyncedAt: { sort: string; nulls: string } }[];
      take: number;
    }>(findMany, 0, 0);
    expect(args.take).toBe(25);
    expect(args.orderBy[0].lastSyncedAt).toEqual({ sort: 'asc', nulls: 'first' });
  });

  it('lọc theo tổ chức khi được chỉ định', async () => {
    const { repo, findMany } = build();

    await repo.findOrdersToSync(10, 'org-1');

    const { where } = callArg<{ where: { organizationId?: string } }>(findMany, 0, 0);
    expect(where.organizationId).toBe('org-1');
  });
});
