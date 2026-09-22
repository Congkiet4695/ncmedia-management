import { PodListingJobItemStatus } from '@prisma/client';
import { PodListingJobService } from './pod-listing-job.service';

/**
 * **Bộ quét item treo** (CASE 5 / CASE 9 của flow nhân bản): item PROCESSING quá hạn vì tiến
 * trình chết giữa chừng phải được khôi phục CÓ ĐẾM — trả về hàng đợi khi còn lượt, FAILED với
 * mã `JOB_TIMEOUT` khi hết lượt. Không bao giờ treo vĩnh viễn (khoá cặp sản phẩm/shop của lượt
 * khác), không bao giờ tự coi là SUCCESS.
 */

const STARTED = new Date('2026-09-22T08:00:00Z');

function buildService(staleItems: Array<{ id: string; retryCount: number; maxRetries?: number }>) {
  const prisma = {
    podListingJobItem: {
      findMany: jest.fn().mockResolvedValue(
        staleItems.map((item) => ({
          id: item.id,
          jobId: 'job-1',
          organizationId: 'org-1',
          retryCount: item.retryCount,
          startedAt: STARTED,
          job: { maxRetries: item.maxRetries ?? 3 },
        })),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    podListingJob: { findMany: jest.fn().mockResolvedValue([]) },
    podListingLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const settleItem = jest.fn().mockResolvedValue(undefined);
  const service = Object.create(PodListingJobService.prototype) as PodListingJobService;
  Object.assign(service, {
    prisma,
    settleItem,
    stopping: false,
    running: new Set<string>(),
    runInBackground: jest.fn(),
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  const sweep = () => (service as unknown as { sweep(): Promise<void> }).sweep();
  return { prisma, settleItem, sweep };
}

describe('PodListingJobService.sweep — item treo', () => {
  it('còn lượt ⇒ trả về PENDING, retryCount + 1, ghi lý do JOB_TIMEOUT (không mất lịch sử)', async () => {
    const { prisma, settleItem, sweep } = buildService([{ id: 'item-1', retryCount: 0 }]);

    await sweep();

    expect(settleItem).not.toHaveBeenCalled();
    expect(prisma.podListingJobItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-1' },
        data: expect.objectContaining({
          status: PodListingJobItemStatus.PENDING,
          startedAt: null,
          retryCount: 1,
          errorCode: 'JOB_TIMEOUT',
          error: expect.stringContaining('2026-09-22T08:00:00') as unknown,
        }) as unknown,
      }),
    );
  });

  it('hết lượt ⇒ FAILED với mã JOB_TIMEOUT và lý do rõ — không SUCCESS, không treo tiếp', async () => {
    const { prisma, settleItem, sweep } = buildService([{ id: 'item-2', retryCount: 3 }]);

    await sweep();

    expect(prisma.podListingJobItem.update).not.toHaveBeenCalled();
    expect(settleItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item-2',
        status: PodListingJobItemStatus.FAILED,
        errorCode: 'JOB_TIMEOUT',
        error: expect.stringContaining('Quá thời gian xử lý') as unknown,
      }),
    );
  });

  it('chỉ quét item PROCESSING quá hạn của job chưa huỷ', async () => {
    const { prisma, sweep } = buildService([]);

    await sweep();

    expect(prisma.podListingJobItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: PodListingJobItemStatus.PROCESSING,
          startedAt: { lt: expect.any(Date) as Date },
        }) as unknown,
      }),
    );
  });
});
