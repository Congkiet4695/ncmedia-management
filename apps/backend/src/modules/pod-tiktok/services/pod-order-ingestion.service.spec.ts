import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PodOrderMapper } from '../mappers/pod-order.mapper';
import { PodOrderRepository } from '../repositories/pod-order.repository';
import { TiktokEncryptionService } from './tiktok-encryption.service';
import { PodOrderIngestionService, IngestionContext } from './pod-order-ingestion.service';
import { TiktokOrder } from '../types/tiktok-order.types';
import { callArg } from '../../../testing/mock-call.util';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const SHOP_ID = '33333333-3333-3333-3333-333333333333';

const CTX: IngestionContext = {
  organizationId: ORG_ID,
  accountId: ACCOUNT_ID,
  shopId: SHOP_ID,
  source: 'CRON',
};

const encryptionStub = {
  encrypt: (value: string) => `v1.${Buffer.from(value, 'utf8').toString('base64')}`,
} as unknown as TiktokEncryptionService;

function buildOrder(id: string, updateTime: number, overrides: Partial<TiktokOrder> = {}): TiktokOrder {
  return {
    id,
    status: 'AWAITING_SHIPMENT',
    create_time: 1619611561,
    update_time: updateTime,
    payment: { currency: 'USD', total_amount: '100' },
    line_items: [
      {
        id: `${id}-item-1`,
        sku_id: 'sku-1',
        product_name: 'T-Shirt',
        package_status: 'TO_FULFILL',
        sale_price: '50',
      },
    ],
    packages: [{ id: `${id}-pkg-1` }],
    ...overrides,
  };
}

describe('PodOrderIngestionService — Compare Logic', () => {
  let service: PodOrderIngestionService;
  let prisma: { $transaction: jest.Mock };
  let repo: {
    findSnapshotsByTiktokOrderIds: jest.Mock;
    findItemHashesByOrderIds: jest.Mock;
    createOrder: jest.Mock;
    updateOrder: jest.Mock;
    touchLastSynced: jest.Mock;
    upsertItem: jest.Mock;
    upsertPackages: jest.Mock;
  };
  let mapper: PodOrderMapper;

  beforeEach(() => {
    prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) };
    repo = {
      findSnapshotsByTiktokOrderIds: jest.fn().mockResolvedValue(new Map()),
      findItemHashesByOrderIds: jest.fn().mockResolvedValue(new Map()),
      createOrder: jest.fn().mockResolvedValue({ id: 'new-order-uuid' }),
      updateOrder: jest.fn().mockResolvedValue(undefined),
      touchLastSynced: jest.fn().mockResolvedValue(undefined),
      upsertItem: jest.fn().mockResolvedValue(undefined),
      upsertPackages: jest.fn().mockResolvedValue(undefined),
    };
    mapper = new PodOrderMapper(encryptionStub);
    service = new PodOrderIngestionService(
      prisma as unknown as PrismaService,
      repo as unknown as PodOrderRepository,
      mapper,
    );
  });

  /** Snapshot của đơn đã tồn tại trong DB. */
  function snapshotOf(order: TiktokOrder, overrides: Partial<Record<string, unknown>> = {}) {
    return new Map([
      [
        order.id,
        {
          id: 'existing-uuid',
          tiktokOrderId: order.id,
          tiktokUpdateTime: BigInt(order.update_time),
          payloadHash: mapper.hashOrder(order),
          recipientMasked: false,
          syncVersion: 1,
          ...overrides,
        },
      ],
    ]);
  }

  describe('CREATE — đơn chưa tồn tại', () => {
    it('tạo mới đơn + item + package', async () => {
      const result = await service.ingestBatch([buildOrder('order-1', 1000)], CTX);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(repo.createOrder).toHaveBeenCalledTimes(1);
      expect(repo.upsertItem).toHaveBeenCalledTimes(1);
      expect(repo.upsertPackages).toHaveBeenCalledTimes(1);
    });

    it('gắn đúng tenant/account/shop và nguồn ghi', async () => {
      await service.ingestBatch([buildOrder('order-1', 1000)], CTX);
      const data = callArg<Record<string, unknown>>(repo.createOrder, 0, 1);
      expect(data.organizationId).toBe(ORG_ID);
      expect(data.accountId).toBe(ACCOUNT_ID);
      expect(data.shopId).toBe(SHOP_ID);
      expect(data.syncSource).toBe('CRON');
      expect(data.syncVersion).toBe(0);
    });

    it('trả về maxUpdateTime lớn nhất của lô (phục vụ watermark)', async () => {
      const result = await service.ingestBatch(
        [buildOrder('a', 1000), buildOrder('b', 5000), buildOrder('c', 3000)],
        CTX,
      );
      expect(result.maxUpdateTime).toBe(5000n);
      expect(result.created).toBe(3);
    });
  });

  describe('UPDATE — đơn đã tồn tại và có thay đổi', () => {
    it('update_time mới hơn → UPDATE', async () => {
      const old = buildOrder('order-1', 1000);
      repo.findSnapshotsByTiktokOrderIds.mockResolvedValue(snapshotOf(old));

      const result = await service.ingestBatch([buildOrder('order-1', 2000)], CTX);

      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(0);
      expect(repo.updateOrder).toHaveBeenCalledTimes(1);
    });

    it('update_time không đổi nhưng NỘI DUNG đổi → vẫn UPDATE (lưới an toàn)', async () => {
      const old = buildOrder('order-1', 1000);
      repo.findSnapshotsByTiktokOrderIds.mockResolvedValue(snapshotOf(old));

      const changed = buildOrder('order-1', 1000, { status: 'IN_TRANSIT' });
      const result = await service.ingestBatch([changed], CTX);

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('tăng syncVersion mỗi lần cập nhật', async () => {
      const old = buildOrder('order-1', 1000);
      repo.findSnapshotsByTiktokOrderIds.mockResolvedValue(snapshotOf(old));
      await service.ingestBatch([buildOrder('order-1', 2000)], CTX);

      const patch = callArg<Record<string, unknown>>(repo.updateOrder, 0, 2);
      expect(patch.syncVersion).toEqual({ increment: 1 });
    });

    it('chỉ ghi item có hash thay đổi (không update item không đổi)', async () => {
      const old = buildOrder('order-1', 1000);
      repo.findSnapshotsByTiktokOrderIds.mockResolvedValue(snapshotOf(old));
      // Item hiện tại có hash trùng với item sắp ghi ⇒ phải bỏ qua.
      repo.findItemHashesByOrderIds.mockResolvedValue(
        new Map([
          ['existing-uuid', new Map([[old.line_items![0].id, mapper.hashItem(old.line_items![0])]])],
        ]),
      );

      await service.ingestBatch([buildOrder('order-1', 2000)], CTX);
      expect(repo.upsertItem).not.toHaveBeenCalled();
    });

    it('ghi item khi nội dung item thay đổi', async () => {
      const old = buildOrder('order-1', 1000);
      repo.findSnapshotsByTiktokOrderIds.mockResolvedValue(snapshotOf(old));
      repo.findItemHashesByOrderIds.mockResolvedValue(
        new Map([['existing-uuid', new Map([[old.line_items![0].id, 'hash-cu-khac']])]]),
      );

      await service.ingestBatch([buildOrder('order-1', 2000)], CTX);
      expect(repo.upsertItem).toHaveBeenCalledTimes(1);
    });

    it('🔴 KHÔNG ghi đè PII thật bằng dữ liệu đã bị TikTok che', async () => {
      const withAddress = buildOrder('order-1', 1000, {
        recipient_address: { name: 'David Kong', phone_number: '213-555-1234', region_code: 'US' },
      });
      repo.findSnapshotsByTiktokOrderIds.mockResolvedValue(
        snapshotOf(withAddress, { recipientMasked: false }),
      );

      const maskedNow = buildOrder('order-1', 2000, {
        recipient_address: { name: '****', phone_number: '***', region_code: 'US' },
      });
      await service.ingestBatch([maskedNow], CTX);

      const patch = callArg<Record<string, unknown>>(repo.updateOrder, 0, 2);
      expect(patch.recipientEnc).toBeUndefined();
      expect(patch.recipientPostalCode).toBeUndefined();
      expect(patch.recipientRegionCode).toBeUndefined();
      expect(patch.recipientMasked).toBe(true);
    });

    it('vẫn ghi recipient khi dữ liệu KHÔNG bị che', async () => {
      const old = buildOrder('order-1', 1000, {
        recipient_address: { name: 'David Kong', region_code: 'US', postal_code: '95110' },
      });
      repo.findSnapshotsByTiktokOrderIds.mockResolvedValue(snapshotOf(old));

      await service.ingestBatch(
        [
          buildOrder('order-1', 2000, {
            recipient_address: { name: 'David Kong Jr', region_code: 'US', postal_code: '95111' },
          }),
        ],
        CTX,
      );

      const patch = callArg<Record<string, unknown>>(repo.updateOrder, 0, 2);
      expect(patch.recipientEnc).toBeDefined();
      expect(patch.recipientPostalCode).toBe('95111');
    });
  });

  describe('SKIP — đơn không thay đổi', () => {
    it('cùng update_time và cùng hash → SKIP, không ghi DB', async () => {
      const order = buildOrder('order-1', 1000);
      repo.findSnapshotsByTiktokOrderIds.mockResolvedValue(snapshotOf(order));

      const result = await service.ingestBatch([order], CTX);

      expect(result.skipped).toBe(1);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(repo.createOrder).not.toHaveBeenCalled();
      expect(repo.updateOrder).not.toHaveBeenCalled();
      expect(repo.upsertItem).not.toHaveBeenCalled();
    });

    it('chỉ chạm last_synced_at bằng MỘT lệnh updateMany cho cả lô', async () => {
      const a = buildOrder('a', 1000);
      const b = buildOrder('b', 1000);
      const snapshots = new Map([...snapshotOf(a), ...snapshotOf(b)]);
      repo.findSnapshotsByTiktokOrderIds.mockResolvedValue(snapshots);

      await service.ingestBatch([a, b], CTX);

      expect(repo.touchLastSynced).toHaveBeenCalledTimes(1);
      expect(repo.touchLastSynced).toHaveBeenCalledWith(['a', 'b'], ORG_ID, expect.any(Date));
    });

    it('chạy lại 3 lần cùng payload → chỉ tạo 1 lần, sau đó SKIP (idempotent)', async () => {
      const order = buildOrder('order-1', 1000);

      const first = await service.ingestBatch([order], CTX);
      expect(first.created).toBe(1);

      repo.findSnapshotsByTiktokOrderIds.mockResolvedValue(snapshotOf(order));
      const second = await service.ingestBatch([order], CTX);
      const third = await service.ingestBatch([order], CTX);

      expect(second.skipped).toBe(1);
      expect(third.skipped).toBe(1);
      expect(repo.createOrder).toHaveBeenCalledTimes(1);
    });

    it('force = true → ghi đè kể cả khi không đổi', async () => {
      const order = buildOrder('order-1', 1000);
      repo.findSnapshotsByTiktokOrderIds.mockResolvedValue(snapshotOf(order));

      const result = await service.ingestBatch([order], { ...CTX, force: true });

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);
    });
  });

  describe('Duplicate Order — race condition', () => {
    it('INSERT gặp UNIQUE conflict → tự chuyển sang UPDATE, không tính lỗi', async () => {
      const order = buildOrder('order-1', 1000);
      // Lần đầu chưa thấy đơn; khi INSERT thì bị trùng; lần tra sau đã thấy.
      repo.findSnapshotsByTiktokOrderIds
        .mockResolvedValueOnce(new Map())
        .mockResolvedValueOnce(snapshotOf(order));
      repo.createOrder.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.0.0',
        }),
      );

      const result = await service.ingestBatch([order], CTX);

      expect(result.updated).toBe(1);
      expect(result.failed).toBe(0);
      expect(repo.updateOrder).toHaveBeenCalledTimes(1);
    });

    it('lỗi DB khác → tính failed, KHÔNG làm hỏng cả lô', async () => {
      repo.createOrder
        .mockRejectedValueOnce(new Error('DB connection lost'))
        .mockResolvedValueOnce({ id: 'ok-uuid' });

      const result = await service.ingestBatch([buildOrder('a', 1000), buildOrder('b', 2000)], CTX);

      expect(result.failed).toBe(1);
      expect(result.created).toBe(1);
    });
  });

  it('lô rỗng → không gọi DB', async () => {
    const result = await service.ingestBatch([], CTX);
    expect(result.total).toBe(0);
    expect(repo.findSnapshotsByTiktokOrderIds).not.toHaveBeenCalled();
  });

  it('đọc snapshot bằng MỘT query cho cả lô (chống N+1)', async () => {
    await service.ingestBatch(
      [buildOrder('a', 1), buildOrder('b', 2), buildOrder('c', 3)],
      CTX,
    );
    expect(repo.findSnapshotsByTiktokOrderIds).toHaveBeenCalledTimes(1);
    expect(repo.findSnapshotsByTiktokOrderIds).toHaveBeenCalledWith(ORG_ID, ['a', 'b', 'c']);
  });
});
