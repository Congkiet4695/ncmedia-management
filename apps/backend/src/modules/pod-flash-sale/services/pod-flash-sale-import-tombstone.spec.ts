import { PodFlashSaleImportService } from './pod-flash-sale-import.service';

/**
 * "Sync from TikTok" KHÔNG hồi sinh đợt sale người dùng đã xoá cứng: activity có bia mộ ⇒ bỏ qua,
 * không gọi Get Activity, không tạo bản ghi.
 */
describe('PodFlashSaleImportService — bia mộ của đợt đã xoá cứng', () => {
  function build(tombstone: { id: string } | null) {
    const prisma = {
      podFlashSale: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      podFlashSaleTombstone: { findUnique: jest.fn().mockResolvedValue(tombstone) },
      $transaction: jest.fn(),
    };
    const promotionApi = {
      getActivity: jest.fn().mockRejectedValue(new Error('không được gọi tới đây')),
    };
    const service = new PodFlashSaleImportService(
      prisma as never,
      {} as never,
      { mapProviderStatus: jest.fn() } as never,
      promotionApi as never,
      {} as never,
      {} as never,
    );
    const importActivity = (
      service as unknown as {
        importActivity: (...args: unknown[]) => Promise<{ kind: string }>;
      }
    ).importActivity.bind(service);
    return { prisma, promotionApi, importActivity };
  }

  const shop = { id: 'shop-1', accountId: 'acc-1' };
  const summary = { id: 'act-1', activityType: 'FLASHSALE', status: 'EXPIRED' };

  it('🔴 activity đã có bia mộ ⇒ skipped, không gọi TikTok, không tạo đợt sale', async () => {
    const { prisma, promotionApi, importActivity } = build({ id: 't-1' });
    await expect(importActivity('org-1', 'user-1', shop, {}, summary)).resolves.toEqual({
      kind: 'skipped',
    });
    expect(prisma.podFlashSaleTombstone.findUnique).toHaveBeenCalledWith({
      where: { shopId_providerFlashSaleId: { shopId: 'shop-1', providerFlashSaleId: 'act-1' } },
      select: { id: true },
    });
    expect(promotionApi.getActivity).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('activity không có bia mộ ⇒ đi tiếp luồng import (đọc chi tiết từ TikTok)', async () => {
    const { promotionApi, importActivity } = build(null);
    await expect(importActivity('org-1', 'user-1', shop, {}, summary)).rejects.toThrow(
      'không được gọi tới đây',
    );
    expect(promotionApi.getActivity).toHaveBeenCalledTimes(1);
  });
});
