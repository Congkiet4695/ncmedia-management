import { PodTiktokAccountStatus, PodTiktokShopStatus, type Prisma } from '@prisma/client';
import { callArg } from '../../../testing/mock-call.util';
import type { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import type { PodListingPublisherService } from './pod-listing-publisher.service';
import { PodListingReviewService } from './pod-listing-review.service';

/**
 * Scheduler đọc trạng thái duyệt listing (5 phút/lần) gọi Get Product theo shop — đây là một đường
 * TỰ ĐỘNG gọi Product API. 🔴 Shop INACTIVE / mất uỷ quyền / kết nối hỏng không được chọn; nút
 * "Đồng bộ" thủ công giữ nguyên hành vi.
 */
describe('PodListingReviewService — chỉ shop ACTIVE ở lượt theo lịch', () => {
  function build() {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { podListingPayload: { findMany } };
    const productApi = { getProduct: jest.fn() };
    const service = new PodListingReviewService(
      prisma as never,
      {} as PodListingPublisherService,
      productApi as unknown as TiktokProductApiService,
    );
    const where = (call = 0) =>
      callArg<{ where: Prisma.PodListingPayloadWhereInput }>(findMany, call, 0).where;
    return { service, where, productApi };
  }

  it('🔴 TC19 tick theo lịch ⇒ lọc shop ACTIVE + kết nối ACTIVE ngay tại truy vấn, không gọi TikTok khi rỗng', async () => {
    const { service, where, productApi } = build();

    await service.tick();

    expect(where().shop).toEqual({
      deletedAt: null,
      status: PodTiktokShopStatus.ACTIVE,
      account: { deletedAt: null, status: PodTiktokAccountStatus.ACTIVE },
    });
    expect(productApi.getProduct).not.toHaveBeenCalled();
  });

  it('nút "Đồng bộ" thủ công (sync có organizationId) ⇒ KHÔNG thêm bộ lọc trạng thái shop (giữ hành vi cũ)', async () => {
    const { service, where } = build();

    await service.sync({ organizationId: 'org-1' });

    expect(where().shop).toBeUndefined();
    expect(where().organizationId).toBe('org-1');
  });
});
