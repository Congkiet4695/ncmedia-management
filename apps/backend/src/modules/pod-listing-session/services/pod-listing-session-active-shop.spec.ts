import {
  PodListingSessionProductStatus,
  PodListingSessionStatus,
  PodListingSessionTemplateType,
  PodTiktokAccountStatus,
  PodTiktokShopStatus,
} from '@prisma/client';
import { POD_SESSION_VALIDATION_CODES } from '../constants/pod-listing-session.constants';
import {
  PodAccessScopeService,
  POD_SCOPE_SYSTEM,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { ACTIVE_SHOP_WHERE } from '../../pod-tiktok/shared/active-shop';
import { PodListingSessionService } from './pod-listing-session.service';

/**
 * Listing (CSV & Add Custom Listing) chỉ đăng lên shop ĐANG HOẠT ĐỘNG.
 *
 * Dropdown đã lọc ở `GET /pod/products/filters?activeShopsOnly=true`; đây là hàng rào backend: client tự gửi
 * `shopIds` của shop đã ngưng (sửa request trên trình duyệt) vẫn bị từ chối. `createCustom` / `updateCustom`
 * đi qua đúng `create` / `update` này nên một bộ test phủ cả hai luồng.
 */

type ShopRow = {
  id: string;
  name: string;
  deletedAt: Date | null;
  status: PodTiktokShopStatus;
  account: { deletedAt: Date | null; status: PodTiktokAccountStatus } | null;
};

const activeAccount = { deletedAt: null, status: PodTiktokAccountStatus.ACTIVE };
const shop = (id: string, over: Partial<ShopRow> = {}): ShopRow => ({
  id,
  name: `Shop ${id}`,
  deletedAt: null,
  status: PodTiktokShopStatus.ACTIVE,
  account: activeAccount,
  ...over,
});

class ReachedCreate extends Error {}

function build(shops: ShopRow[], session: Record<string, unknown> | null = null) {
  const prisma = {
    platform: { findFirst: jest.fn().mockResolvedValue({ id: 'platform-1' }) },
    podTiktokShop: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(shops.filter((row) => where.id.in.includes(row.id))),
      ),
    },
    podListingSession: {
      // Qua được kiểm tra shop ⇒ chạm tới lệnh ghi; test dừng ở đây bằng một lỗi đánh dấu.
      create: jest.fn().mockRejectedValue(new ReachedCreate()),
      update: jest.fn().mockRejectedValue(new ReachedCreate()),
      findFirst: jest.fn().mockResolvedValue(session),
    },
    podListingSessionProduct: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const service = new PodListingSessionService(
    prisma as never,
    new PodAccessScopeService(prisma as never),
    { resolveFromContext: jest.fn() } as never,
    { validate: jest.fn() } as never,
    { getForSession: jest.fn() } as never,
    { createFromSession: jest.fn() } as never,
    { withLock: jest.fn() } as never,
  );
  return { service, prisma };
}

const create = (service: PodListingSessionService, shopIds: string[], scope: PodAccessScope = POD_SCOPE_SYSTEM) =>
  service.create('org-1', 'user-1', { name: 'Lô', market: 'US', shopIds } as never, scope);

const errorCode = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    if (error instanceof ReachedCreate) return 'REACHED_CREATE';
    return (error as { response?: { code?: string } }).response?.code ?? String(error);
  }
};

describe('Listing — chỉ shop đang hoạt động (backend)', () => {
  it('shop ACTIVE thuộc kết nối ACTIVE ⇒ qua kiểm tra shop', async () => {
    const { service, prisma } = build([shop('s1'), shop('s2')]);
    expect(await errorCode(create(service, ['s1', 's2']))).toBe('REACHED_CREATE');
    expect(prisma.podTiktokShop.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['s1', 's2'] }, organizationId: 'org-1', deletedAt: null } }),
    );
  });

  it.each([
    ['shop INACTIVE', shop('s1', { status: PodTiktokShopStatus.INACTIVE })],
    ['shop DEAUTHORIZED', shop('s1', { status: PodTiktokShopStatus.DEAUTHORIZED })],
    ['kết nối DISCONNECTED', shop('s1', { account: { deletedAt: null, status: PodTiktokAccountStatus.DISCONNECTED } })],
    ['kết nối REAUTH_REQUIRED', shop('s1', { account: { deletedAt: null, status: PodTiktokAccountStatus.REAUTH_REQUIRED } })],
    ['kết nối đã xoá', shop('s1', { account: { deletedAt: new Date(), status: PodTiktokAccountStatus.ACTIVE } })],
  ])('🔴 gửi thẳng request với %s ⇒ 400 POD_SESSION_SHOP_INACTIVE, không ghi gì', async (_label, row) => {
    const { service, prisma } = build([row, shop('s2')]);
    expect(await errorCode(create(service, ['s2', 's1']))).toBe('POD_SESSION_SHOP_INACTIVE');
    expect(prisma.podListingSession.create).not.toHaveBeenCalled();
  });

  it('shop không thuộc tổ chức / không tồn tại ⇒ vẫn là POD_SESSION_INVALID_SHOP (giữ nguyên)', async () => {
    const { service } = build([shop('s1')]);
    expect(await errorCode(create(service, ['s1', 'other-org-shop']))).toBe('POD_SESSION_INVALID_SHOP');
  });

  it('shop ngoài phạm vi của Seller ⇒ 403 trước cả khi đọc trạng thái', async () => {
    const { service, prisma } = build([shop('s1')]);
    const sellerScope: PodAccessScope = { allShops: false, accountIds: ['acc-x'], shopIds: ['s-x'] };
    expect(await errorCode(create(service, ['s1'], sellerScope))).toBe('POD_SHOP_FORBIDDEN');
    expect(prisma.podTiktokShop.findMany).not.toHaveBeenCalled();
  });

  it('SỬA lượt đăng (Listing CSV & Custom) cũng bị chặn khi gửi shop đã ngưng', async () => {
    const session = {
      id: 'session-1',
      organizationId: 'org-1',
      market: 'US',
      status: PodListingSessionStatus.DRAFT,
      shops: [],
      templates: [],
    };
    const { service, prisma } = build([shop('s1', { status: PodTiktokShopStatus.INACTIVE })], session);
    expect(
      await errorCode(service.update('org-1', 'user-1', 'session-1', { shopIds: ['s1'] }, POD_SCOPE_SYSTEM)),
    ).toBe('POD_SESSION_SHOP_INACTIVE');
    expect(prisma.podListingSession.update).not.toHaveBeenCalled();
  });

  it('lượt đăng đã lưu có shop bị ngưng SAU khi chọn ⇒ cổng Validate (cũng là cổng Start) chặn', async () => {
    const session = {
      id: 'session-1',
      organizationId: 'org-1',
      market: 'US',
      status: PodListingSessionStatus.DRAFT,
      shops: [
        { shopId: 's1', shop: { region: 'US', ...shop('s1', { status: PodTiktokShopStatus.INACTIVE }) } },
      ],
      templates: [
        {
          templateType: PodListingSessionTemplateType.CATEGORY,
          categoryTemplateId: 'cat-1',
          skuTemplateId: null,
          descriptionTemplateId: null,
          imageTemplateId: null,
          pricingStrategyId: null,
        },
      ],
    };
    const { service, prisma } = build([], session);
    prisma.podListingSession.update.mockResolvedValue(session);
    prisma.podListingSessionProduct.findMany.mockResolvedValue([
      { id: 'p1', title: 'T', status: PodListingSessionProductStatus.DRAFT, images: [{ imageUrl: 'x' }], manualData: null },
    ]);

    const result = await service.validate('org-1', 'session-1', POD_SCOPE_SYSTEM);
    expect(result.ok).toBe(false);
    expect(result.readyProducts).toBe(0);
    const issue = result.issues.find((item) => item.code === POD_SESSION_VALIDATION_CODES.SHOP_INACTIVE);
    expect(issue?.message).toContain('Shop s1');
  });

  it('điều kiện "shop hoạt động" là MỘT nguồn: shop ACTIVE + kết nối ACTIVE + chưa xoá', () => {
    expect(ACTIVE_SHOP_WHERE).toEqual({
      deletedAt: null,
      status: PodTiktokShopStatus.ACTIVE,
      account: { deletedAt: null, status: PodTiktokAccountStatus.ACTIVE },
    });
  });
});
