import { ConfigService } from '@nestjs/config';
import { PodPayoutStatus } from '@prisma/client';
import { PodPayoutReportRepository } from '../repositories/pod-payout-report.repository';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import { PodPayoutService } from './pod-payout.service';
import { PodPayoutSyncService } from './pod-payout-sync.service';
import { callArg } from '../../../testing/mock-call.util';

const ORG = '11111111-1111-1111-1111-111111111111';
const SELLER = '22222222-2222-2222-2222-222222222222';

/** Múi giờ vận hành: UTC+7 — mọi mốc "Hôm nay/Tháng trước" phải tính theo giờ này. */
const CONFIG: Record<string, number> = {
  timezoneOffsetMinutes: 420,
  'tiktok.sync.runDeadlineMs': 240_000,
};

function summaryRow(over: Record<string, unknown> = {}) {
  return {
    totalPayout: '1102.93',
    currency: 'USD',
    paymentCount: 86,
    accountCount: 1,
    sellerCount: 1,
    orderCount: 143,
    ...over,
  };
}

describe('PodPayoutService', () => {
  let service: PodPayoutService;
  let reportRepo: {
    summary: jest.Mock;
    distinctCurrencies: jest.Mock;
    sellerBreakdown: jest.Mock;
    accountBreakdown: jest.Mock;
  };
  let accountRepo: { listShopsForSync: jest.Mock; findShopForSync: jest.Mock };
  let syncService: { syncShop: jest.Mock };

  beforeEach(() => {
    reportRepo = {
      summary: jest.fn().mockResolvedValue(summaryRow()),
      distinctCurrencies: jest.fn().mockResolvedValue(['USD']),
      sellerBreakdown: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      accountBreakdown: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    accountRepo = {
      listShopsForSync: jest.fn().mockResolvedValue([]),
      findShopForSync: jest.fn().mockResolvedValue(null),
    };
    syncService = { syncShop: jest.fn().mockResolvedValue({ ok: true }) };

    service = new PodPayoutService(
      { get: jest.fn((key: string, fallback?: number) => CONFIG[key] ?? fallback) } as unknown as ConfigService,
      reportRepo as unknown as PodPayoutReportRepository,
      accountRepo as unknown as PodTiktokAccountRepository,
      syncService as unknown as PodPayoutSyncService,
    );
  });

  describe('summary', () => {
    it('trả đúng số tiền repository tính, KHÔNG tự cộng lại ở service', async () => {
      const result = await service.summary(ORG, {});
      expect(result.totalPayout).toBe('1102.93');
      expect(result.currency).toBe('USD');
      expect(result.orderCount).toBe(143);
    });

    it('🔴 nhiều đơn vị tiền tệ → trả về danh sách để FE cảnh báo, không giấu', async () => {
      reportRepo.distinctCurrencies.mockResolvedValue(['GBP', 'USD']);
      const result = await service.summary(ORG, {});
      expect(result.currencies).toEqual(['GBP', 'USD']);
    });

    it('trả về khoảng thời gian đã quy đổi để FE hiển thị đúng thứ đã lọc', async () => {
      const result = await service.summary(ORG, {
        datePreset: 'CUSTOM',
        fromDate: '2026-08-01',
        toDate: '2026-08-05',
      });
      // 00:00 ngày 01/08 giờ VN = 17:00Z ngày 31/07.
      expect(result.range.from).toBe('2026-07-31T17:00:00.000Z');
      expect(result.range.to).toBe('2026-08-05T16:59:59.999Z');
    });
  });

  describe('bộ lọc gửi xuống repository', () => {
    it('quy đổi preset thời gian tại BACKEND theo múi giờ vận hành', async () => {
      await service.summary(ORG, { datePreset: 'TODAY' });
      const filter = callArg<{ from: Date; to: Date }>(reportRepo.summary, 0, 0);
      expect(filter.from).toBeInstanceOf(Date);
      expect(filter.to.getTime()).toBeGreaterThan(filter.from.getTime());
    });

    it('preset ALL → không giới hạn thời gian', async () => {
      await service.summary(ORG, { datePreset: 'ALL' });
      const filter = callArg<{ from?: Date; to?: Date }>(reportRepo.summary, 0, 0);
      expect(filter.from).toBeUndefined();
      expect(filter.to).toBeUndefined();
    });

    it('chuyển tiếp trạng thái payout và từ khoá tìm kiếm', async () => {
      await service.summary(ORG, { payoutStatus: PodPayoutStatus.PAID, search: ' ncmedia ' });
      const filter = callArg<{ status: string; search: string }>(reportRepo.summary, 0, 0);
      expect(filter.status).toBe(PodPayoutStatus.PAID);
      expect(filter.search).toBe(' ncmedia ');
    });

    it('🔴 Admin (không có scope) → xem toàn Organization', async () => {
      await service.summary(ORG, {});
      expect(callArg<{ sellerScope?: string }>(reportRepo.summary, 0, 0).sellerScope).toBeUndefined();
    });

    it('🔴 Seller → CHỈ xem Account do chính mình quản lý', async () => {
      await service.summary(ORG, {}, SELLER);
      expect(callArg<{ sellerScope?: string }>(reportRepo.summary, 0, 0).sellerScope).toBe(SELLER);
    });

    it('mọi truy vấn đều mang organizationId của người gọi (tenant isolation)', async () => {
      await service.sellerBreakdown(ORG, {});
      await service.accountBreakdown(ORG, {});
      expect(callArg<{ organizationId: string }>(reportRepo.sellerBreakdown, 0, 0).organizationId).toBe(ORG);
      expect(callArg<{ organizationId: string }>(reportRepo.accountBreakdown, 0, 0).organizationId).toBe(ORG);
    });
  });

  describe('phân trang & sắp xếp', () => {
    it('🔴 mặc định sắp xếp GIẢM DẦN theo Payout', async () => {
      await service.sellerBreakdown(ORG, {});
      expect(callArg<string>(reportRepo.sellerBreakdown, 0, 3)).toBe('totalPayout');
      expect(callArg<string>(reportRepo.sellerBreakdown, 0, 4)).toBe('desc');
    });

    it('mặc định trang 1, 20 dòng', async () => {
      await service.accountBreakdown(ORG, {});
      expect(callArg<number>(reportRepo.accountBreakdown, 0, 1)).toBe(1);
      expect(callArg<number>(reportRepo.accountBreakdown, 0, 2)).toBe(20);
    });

    it('tôn trọng tham số sắp xếp do người dùng chọn', async () => {
      await service.sellerBreakdown(ORG, { sortField: 'orderCount', sortOrder: 'asc', page: 3, pageSize: 50 });
      expect(callArg<number>(reportRepo.sellerBreakdown, 0, 1)).toBe(3);
      expect(callArg<number>(reportRepo.sellerBreakdown, 0, 2)).toBe(50);
      expect(callArg<string>(reportRepo.sellerBreakdown, 0, 3)).toBe('orderCount');
      expect(callArg<string>(reportRepo.sellerBreakdown, 0, 4)).toBe('asc');
    });

    it('meta phân trang theo ADR-023 (page/limit/totalPages)', async () => {
      reportRepo.accountBreakdown.mockResolvedValue({ items: [], total: 45 });
      const result = await service.accountBreakdown(ORG, { pageSize: 20 });
      expect(result.meta).toEqual({ total: 45, page: 1, limit: 20, totalPages: 3 });
    });

    it('không có dữ liệu → totalPages = 0 (không phải 1)', async () => {
      const result = await service.sellerBreakdown(ORG, {});
      expect(result.meta.totalPages).toBe(0);
    });
  });

  describe('triggerSync', () => {
    it('không truyền shopId → đồng bộ mọi shop CỦA CHÍNH tổ chức người gọi', async () => {
      accountRepo.listShopsForSync.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      const result = await service.triggerSync(ORG, {});
      expect(callArg<string>(accountRepo.listShopsForSync, 0, 1)).toBe(ORG);
      expect(syncService.syncShop).toHaveBeenCalledTimes(2);
      expect(result.shopsSucceeded).toBe(2);
    });

    it('shop không thuộc tổ chức → báo không tìm thấy, KHÔNG gọi TikTok', async () => {
      await expect(service.triggerSync(ORG, { shopId: 'x' })).rejects.toThrow();
      expect(syncService.syncShop).not.toHaveBeenCalled();
    });
  });
});
