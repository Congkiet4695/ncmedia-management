import { PodFlashSaleStatus } from '@prisma/client';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { PodFlashSaleDeletionService } from './pod-flash-sale-deletion.service';

/**
 * Xoá cứng Flash Sale (từng đợt + hàng loạt). Luật được khoá:
 *  - Chỉ đợt của tổ chức hiện tại, trong phạm vi shop của người dùng (Employee/Seller không xoá được đợt
 *    của shop người khác — IDOR).
 *  - RUNNING / PUBLISHING không xoá được (kiểm 2 lần: trước và TRONG transaction có khoá hàng).
 *  - Shop đang đồng bộ / chuỗi Auto đang chạy ⇒ dòng đó BUSY, không xoá.
 *  - Đợt đã lên sàn ⇒ ghi bia mộ để "Sync from TikTok" không hồi sinh.
 *  - Kết quả theo từng dòng; id trùng được gộp.
 */

type Row = {
  id: string;
  shopId: string;
  status: PodFlashSaleStatus;
  autoMode?: boolean;
  autoChainId?: string | null;
  providerFlashSaleId?: string | null;
};

const ORG = 'org-1';
const ADMIN: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };
const SELLER: PodAccessScope = { allShops: false, accountIds: ['acc-1'], shopIds: ['shop-1'] };

function build(
  rows: Row[],
  opts: {
    busyLocks?: string[];
    statusInTx?: Record<string, PodFlashSaleStatus>;
    txError?: Error;
  } = {},
) {
  const tx = {
    $queryRaw: jest.fn((sql: { sql: string; values: unknown[] }) => {
      if (sql.sql.includes('set_config')) return Promise.resolve([{}]);
      const ids = sql.values[0] as string[];
      return Promise.resolve(
        rows
          .filter((row) => ids.includes(row.id))
          .map((row) => ({
            id: row.id,
            status: opts.statusInTx?.[row.id] ?? row.status,
            shop_id: row.shopId,
            provider_flash_sale_id: row.providerFlashSaleId ?? null,
          })),
      );
    }),
    podFlashSaleTombstone: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    podFlashSale: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    podFlashSale: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          rows
            .filter((row) => where.id.in.includes(row.id))
            .map((row) => ({ autoMode: false, autoChainId: null, ...row })),
        ),
      ),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      opts.txError ? Promise.reject(opts.txError) : fn(tx),
    ),
  };
  const locks = {
    acquire: jest.fn((key: string) =>
      Promise.resolve(
        (opts.busyLocks ?? []).some((busy) => key.endsWith(busy)) ? null : { key, fenceToken: 'f' },
      ),
    ),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PodFlashSaleDeletionService(
    prisma as never,
    new PodAccessScopeService(prisma as never),
    locks as never,
  );
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  return { service, prisma, tx, locks };
}

describe('PodFlashSaleDeletionService', () => {
  it('xoá NHIỀU: xoá cứng đúng các đợt hợp lệ + ghi bia mộ cho đợt đã lên sàn; id trùng được gộp', async () => {
    const { service, tx, locks } = build([
      {
        id: 'fs-1',
        shopId: 'shop-1',
        status: PodFlashSaleStatus.ENDED,
        providerFlashSaleId: 'act-1',
      },
      { id: 'fs-2', shopId: 'shop-2', status: PodFlashSaleStatus.DRAFT },
    ]);
    const result = await service.removeMany(ORG, 'user-1', ['fs-1', 'fs-2', 'fs-1'], ADMIN);

    expect(result).toEqual({ requested: 2, deleted: ['fs-1', 'fs-2'], failed: [] });
    expect(tx.podFlashSale.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['fs-1', 'fs-2'] }, organizationId: ORG },
    });
    expect(tx.podFlashSaleTombstone.createMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId: ORG,
          shopId: 'shop-1',
          providerFlashSaleId: 'act-1',
          createdBy: 'user-1',
        },
      ],
      skipDuplicates: true,
    });
    // Khoá import của từng shop được giữ trong lúc xoá và luôn được trả lại.
    expect(locks.acquire).toHaveBeenCalledWith(
      'pod:flash-sale:import:lock:shop-1',
      expect.any(Number),
    );
    expect(locks.release).toHaveBeenCalledTimes(2);
  });

  it('🔴 id không tồn tại / của tổ chức khác ⇒ NOT_FOUND, không xoá gì', async () => {
    const { service, prisma } = build([]);
    const result = await service.removeMany(ORG, 'user-1', ['nope'], ADMIN);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 'nope', code: 'POD_FLASH_SALE_NOT_FOUND' }),
    ]);
    expect(prisma.podFlashSale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['nope'] }, organizationId: ORG, deletedAt: null },
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('🔴 Employee xoá đợt của shop KHÔNG được gán ⇒ POD_SHOP_FORBIDDEN, đợt hợp lệ vẫn xoá', async () => {
    const { service, tx } = build([
      { id: 'fs-mine', shopId: 'shop-1', status: PodFlashSaleStatus.DRAFT },
      { id: 'fs-other', shopId: 'shop-9', status: PodFlashSaleStatus.DRAFT },
    ]);
    const result = await service.removeMany(ORG, 'seller-1', ['fs-mine', 'fs-other'], SELLER);
    expect(result.deleted).toEqual(['fs-mine']);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 'fs-other', code: 'POD_SHOP_FORBIDDEN' }),
    ]);
    expect(tx.podFlashSale.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['fs-mine'] }, organizationId: ORG },
    });
  });

  it('🔴 RUNNING / PUBLISHING ⇒ INVALID_STATE (phải Cancel trước)', async () => {
    const { service, prisma } = build([
      { id: 'fs-run', shopId: 'shop-1', status: PodFlashSaleStatus.RUNNING },
      { id: 'fs-pub', shopId: 'shop-1', status: PodFlashSaleStatus.PUBLISHING },
    ]);
    const result = await service.removeMany(ORG, 'user-1', ['fs-run', 'fs-pub'], ADMIN);
    expect(result.deleted).toEqual([]);
    expect(result.failed.map((row) => row.code)).toEqual([
      'POD_FLASH_SALE_INVALID_STATE',
      'POD_FLASH_SALE_INVALID_STATE',
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('🔴 publisher chuyển sang PUBLISHING ngay trước khi khoá hàng ⇒ kiểm lại trong transaction và từ chối', async () => {
    const { service, tx } = build(
      [{ id: 'fs-1', shopId: 'shop-1', status: PodFlashSaleStatus.READY }],
      {
        statusInTx: { 'fs-1': PodFlashSaleStatus.PUBLISHING },
      },
    );
    const result = await service.removeMany(ORG, 'user-1', ['fs-1'], ADMIN);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 'fs-1', code: 'POD_FLASH_SALE_INVALID_STATE' }),
    ]);
    expect(tx.podFlashSale.deleteMany).not.toHaveBeenCalled();
  });

  it('🔴 shop đang đồng bộ từ TikTok (job nền) ⇒ IMPORT_BUSY cho đợt của shop đó', async () => {
    const { service, tx } = build(
      [
        { id: 'fs-1', shopId: 'shop-1', status: PodFlashSaleStatus.ENDED },
        { id: 'fs-2', shopId: 'shop-2', status: PodFlashSaleStatus.ENDED },
      ],
      { busyLocks: ['import:lock:shop-1'] },
    );
    const result = await service.removeMany(ORG, 'user-1', ['fs-1', 'fs-2'], ADMIN);
    expect(result.deleted).toEqual(['fs-2']);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 'fs-1', code: 'POD_FLASH_SALE_IMPORT_BUSY' }),
    ]);
    expect(tx.podFlashSale.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['fs-2'] }, organizationId: ORG },
    });
  });

  it('🔴 đợt thuộc chuỗi Auto khi lượt Auto đang chạy ⇒ AUTO_BUSY; đợt thường vẫn xoá', async () => {
    const { service } = build(
      [
        { id: 'fs-auto', shopId: 'shop-1', status: PodFlashSaleStatus.ENDED, autoMode: true },
        { id: 'fs-plain', shopId: 'shop-1', status: PodFlashSaleStatus.ENDED },
      ],
      { busyLocks: [`auto:lock:${ORG}`] },
    );
    const result = await service.removeMany(ORG, 'user-1', ['fs-auto', 'fs-plain'], ADMIN);
    expect(result.deleted).toEqual(['fs-plain']);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 'fs-auto', code: 'POD_FLASH_SALE_AUTO_BUSY' }),
    ]);
  });

  it('hết lock_timeout (một thao tác khác giữ đợt sale) ⇒ cả lô LOCKED, không xoá gì', async () => {
    const { service } = build(
      [{ id: 'fs-1', shopId: 'shop-1', status: PodFlashSaleStatus.ENDED }],
      {
        txError: Object.assign(new Error('canceling statement due to lock timeout'), {
          code: 'P2010',
          meta: { code: '55P03' },
        }),
      },
    );
    const result = await service.removeMany(ORG, 'user-1', ['fs-1'], ADMIN);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 'fs-1', code: 'POD_FLASH_SALE_LOCKED' }),
    ]);
  });

  it('xoá TỪNG đợt: ném đúng exception của dòng (404 / 409)', async () => {
    const { service } = build([
      { id: 'fs-run', shopId: 'shop-1', status: PodFlashSaleStatus.RUNNING },
    ]);
    await expect(service.remove(ORG, 'user-1', 'missing', ADMIN)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.remove(ORG, 'user-1', 'fs-run', ADMIN)).rejects.toMatchObject({
      status: 409,
    });
  });
});
