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

  it('chỉ lấy đơn ĐANG BAY, không lấy đơn đã kết thúc', async () => {
    const { repo, findMany } = build();

    await repo.findOrdersToSync(50);

    const { where } = callArg<{ where: { status: { in: FulfillmentStatus[] } } }>(findMany, 0, 0);
    expect(where.status.in).toEqual(
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
      expect(where.status.in).not.toContain(terminal);
    }
  });

  it('bỏ qua đơn chưa có mã bên nhà cung cấp và đơn đã xoá mềm', async () => {
    const { repo, findMany } = build();

    await repo.findOrdersToSync(50);

    const { where } = callArg<{ where: Record<string, unknown> }>(findMany, 0, 0);
    expect(where.providerOrderId).toEqual({ not: null });
    expect(where.deletedAt).toBeNull();
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
