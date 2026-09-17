import { FulfillmentStatus, Prisma } from '@prisma/client';
import { PodOrderRepository } from './pod-order.repository';

/**
 * Ba bộ lọc mới của màn hình **Danh sách đơn hàng**: theo Design · theo Fulfillment · theo
 * Nhân viên.
 *
 * 🔴 Vì sao bộ test này tồn tại: cả ba đều là những chỗ RẤT dễ viết ra một mệnh đề "gần
 * đúng", và cái giá của "gần đúng" ở đây là người vận hành bấm Fulfill hàng loạt trên một
 * danh sách sai.
 *
 *  1. **"Đã có design" phải là MỌI sản phẩm, không phải "có ít nhất một".** Đó là quy tắc mà
 *     `FulfillmentReadinessService` dùng (`DESIGN_MISSING` bật khi CÒN MỘT dòng thiếu). Hiểu
 *     thành "có ít nhất một" sẽ xếp đơn 3 sản phẩm mới upload 1 file vào nhóm "đã có design",
 *     rồi lệnh Fulfill bị từ chối.
 *  2. **"Chưa đẩy Fulfill" phải khớp `RESUBMITTABLE_STATUSES`** của `MangoFulfillmentService`.
 *     Lệch một trạng thái là danh sách hiện một đơn dưới nhãn "chưa đẩy" rồi backend trả
 *     `FULFILLMENT_ALREADY_SUBMITTED`.
 *  3. **Nhân viên nằm ở KẾT NỐI, không ở đơn.** Đơn không có cột `seller_id`; lọc nhầm chỗ
 *     thì hoặc không chạy, hoặc chạy trên một bản sao cũ.
 */

/** Prisma giả: chỉ giữ lại `where` mà repository dựng ra. */
function buildRepo(designRows: Array<{ tiktokProductId: string; sellerSku: string }> = []) {
  let capturedWhere: Prisma.PodOrderWhereInput = {};

  const prisma = {
    $transaction: (promises: unknown[]) => Promise.all(promises as Promise<unknown>[]),
    podOrder: {
      findMany: jest.fn((args: { where: Prisma.PodOrderWhereInput }) => {
        capturedWhere = args.where;
        return Promise.resolve([]);
      }),
      count: jest.fn(() => Promise.resolve(0)),
      groupBy: jest.fn((args: { where: Prisma.PodOrderWhereInput }) => {
        capturedWhere = args.where;
        return Promise.resolve([]);
      }),
    },
    fulfillmentProductDesign: {
      findMany: jest.fn(() => Promise.resolve(designRows)),
    },
  };

  const repo = new PodOrderRepository(prisma as never);
  const page = { page: 1, limit: 20, sortBy: 'orderedAt' as const, sortOrder: 'desc' as const };

  return {
    repo,
    prisma,
    where: () => capturedWhere,
    find: (params: Record<string, unknown>) => repo.findMany('org-1', { ...page, ...params }),
  };
}

const DESIGN_ROWS = [
  { tiktokProductId: 'p1', sellerSku: 'sku-a' },
  { tiktokProductId: 'p1', sellerSku: 'sku-b' },
  { tiktokProductId: 'p2', sellerSku: 'sku-c' },
];

/** Điều kiện "item khớp một khoá design" mà repository phải dựng. */
const EXPECTED_ITEM_HAS_DESIGN = {
  OR: [
    { productId: 'p1', sellerSku: { in: ['sku-a', 'sku-b'] } },
    { productId: 'p2', sellerSku: { in: ['sku-c'] } },
  ],
};

describe('PodOrderRepository — lọc theo DESIGN', () => {
  it('🔴 "đã có design" = KHÔNG còn item nào thiếu (MỌI sản phẩm), và đơn phải có item', async () => {
    const ctx = buildRepo(DESIGN_ROWS);

    await ctx.find({ hasDesign: true });

    expect(ctx.where().items).toEqual({
      // `some: {}` loại đơn RỖNG — một đơn không có sản phẩm nào không phải "đã có design".
      some: {},
      none: { NOT: EXPECTED_ITEM_HAS_DESIGN },
    });
  });

  it('🔴 "chưa có design" = CÒN ít nhất một item thiếu (phủ định đúng của vế trên)', async () => {
    const ctx = buildRepo(DESIGN_ROWS);

    await ctx.find({ hasDesign: false });

    expect(ctx.where().items).toEqual({ some: { NOT: EXPECTED_ITEM_HAS_DESIGN } });
  });

  it('gom khoá theo Product ID — số nhánh OR bằng số SẢN PHẨM, không bằng số cặp', async () => {
    const ctx = buildRepo(DESIGN_ROWS);

    await ctx.find({ hasDesign: false });

    const or = (ctx.where().items as { some: { NOT: { OR: unknown[] } } }).some.NOT.OR;
    expect(or).toHaveLength(2);
  });

  it('cắt khoảng trắng thừa ở khoá (khớp `mappingKeyOf`), KHÔNG đổi hoa/thường', async () => {
    const ctx = buildRepo([{ tiktokProductId: '  p1 ', sellerSku: ' SKU-A ' }]);

    await ctx.find({ hasDesign: false });

    const or = (ctx.where().items as { some: { NOT: { OR: unknown[] } } }).some.NOT.OR;
    expect(or).toEqual([{ productId: 'p1', sellerSku: { in: ['SKU-A'] } }]);
  });

  it('tổ chức CHƯA có design nào ⇒ "đã có design" trả về rỗng, "chưa có" lấy mọi đơn có item', async () => {
    const empty = buildRepo([]);
    await empty.find({ hasDesign: true });
    expect(empty.where()).toMatchObject({ id: { in: [] } });

    const empty2 = buildRepo([]);
    await empty2.find({ hasDesign: false });
    expect(empty2.where().items).toEqual({ some: {} });
  });

  it('KHÔNG đụng tới bảng design khi bộ lọc không được dùng', async () => {
    const ctx = buildRepo(DESIGN_ROWS);

    await ctx.find({});

    expect(ctx.prisma.fulfillmentProductDesign.findMany).not.toHaveBeenCalled();
    expect(ctx.where().items).toBeUndefined();
  });
});

describe('PodOrderRepository — lọc theo FULFILLMENT', () => {
  /** Đúng danh sách `RESUBMITTABLE_STATUSES` của `MangoFulfillmentService`. */
  const STILL_SENDABLE = [FulfillmentStatus.DRAFT, FulfillmentStatus.FAILED];

  it('🔴 "chưa đẩy" = không có bản ghi nào ngoài DRAFT/FAILED', async () => {
    const ctx = buildRepo();

    await ctx.find({ pushedToFulfillment: false });

    expect(ctx.where().fulfillmentOrders).toEqual({
      none: { deletedAt: null, status: { notIn: STILL_SENDABLE } },
    });
  });

  it('"đã đẩy" là phủ định đúng của vế trên', async () => {
    const ctx = buildRepo();

    await ctx.find({ pushedToFulfillment: true });

    expect(ctx.where().fulfillmentOrders).toEqual({
      some: { deletedAt: null, status: { notIn: STILL_SENDABLE } },
    });
  });

  it('🔴 bản ghi ĐÃ XOÁ MỀM không được tính là "đã đẩy"', async () => {
    const ctx = buildRepo();

    await ctx.find({ pushedToFulfillment: false });

    const clause = ctx.where().fulfillmentOrders as { none: { deletedAt: null } };
    expect(clause.none.deletedAt).toBeNull();
  });

  it('CANCELLED tính là ĐÃ đẩy — theo đúng luật hiện hành (không gửi lại được)', async () => {
    const ctx = buildRepo();

    await ctx.find({ pushedToFulfillment: false });

    const notIn = (ctx.where().fulfillmentOrders as { none: { status: { notIn: string[] } } }).none
      .status.notIn;
    expect(notIn).not.toContain(FulfillmentStatus.CANCELLED);
  });
});

describe('PodOrderRepository — lọc theo NHÂN VIÊN', () => {
  it('🔴 lọc qua KẾT NỐI (`account.sellerId`), vì đơn không mang seller_id', async () => {
    const ctx = buildRepo();

    await ctx.find({ sellerId: 'employee-1' });

    expect(ctx.where().account).toEqual({ sellerId: 'employee-1' });
  });

  it('không chọn nhân viên ⇒ không thêm điều kiện nào', async () => {
    const ctx = buildRepo();

    await ctx.find({});

    expect(ctx.where().account).toBeUndefined();
  });

  it('phạm vi shop được gán vẫn giữ nguyên khi lọc theo nhân viên', async () => {
    const ctx = buildRepo();

    await ctx.find({ sellerId: 'employee-1', shopScope: ['shop-1'] });

    expect(ctx.where().shopId).toEqual({ in: ['shop-1'] });
    expect(ctx.where().account).toEqual({ sellerId: 'employee-1' });
  });
});

describe('PodOrderRepository — thẻ thống kê dùng CÙNG bộ lọc', () => {
  it('🔴 `countByStatus` dựng cùng mệnh đề với `findMany`', async () => {
    const list = buildRepo(DESIGN_ROWS);
    await list.find({ hasDesign: true, pushedToFulfillment: false, sellerId: 'e1' });
    const listWhere = list.where();

    const stats = buildRepo(DESIGN_ROWS);
    await stats.repo.countByStatus('org-1', {
      hasDesign: true,
      pushedToFulfillment: false,
      sellerId: 'e1',
    });

    expect(stats.where()).toEqual(listWhere);
  });
});
