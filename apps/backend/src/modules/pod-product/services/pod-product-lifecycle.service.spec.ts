import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PodShopForbiddenException } from '../../pod-tiktok/services/pod-access-scope.service';
import { PodProductLifecycleService } from './pod-product-lifecycle.service';

/**
 * **Ngừng bán / Xoá sản phẩm** — luật: sàn trước, database sau. TikTok từ chối (HTTP lỗi HOẶC
 * code 0 kèm `errors[]`) ⇒ không đụng database. Phạm vi kiểm theo shop CỦA BẢN GHI.
 */

const ORG = 'org-1';
const USER = 'user-1';
const PRODUCT = { id: 'prod-1', shopId: 'shop-a', tiktokProductId: 'TT-1' };

function buildService(overrides: {
  product?: typeof PRODUCT | null;
  tiktokThrows?: boolean;
  tiktokErrors?: Array<{ code?: number; message?: string }>;
  lockBusy?: boolean;
  noTarget?: boolean;
} = {}) {
  const repo = {
    findById: jest.fn().mockResolvedValue(overrides.product === undefined ? PRODUCT : overrides.product),
    markDeactivated: jest.fn().mockResolvedValue(undefined),
    softDelete: jest.fn().mockResolvedValue(undefined),
  };
  const syncRepo = {
    findSyncTargets: jest.fn().mockResolvedValue(overrides.noTarget ? [] : [{ id: 'shop-a', account: {} }]),
  };
  const syncService = { syncShop: jest.fn().mockResolvedValue(undefined) };
  const catalog = { buildContext: jest.fn().mockResolvedValue({ accessToken: 't', shopCipher: 'c', shopId: 'shop-a' }) };
  const call = overrides.tiktokThrows
    ? jest.fn().mockRejectedValue(
        Object.assign(new Error('TikTok API error'), { tiktokCode: 12052400, tiktokMessage: 'Sản phẩm đang khuyến mãi' }),
      )
    : jest.fn().mockResolvedValue({ data: { errors: overrides.tiktokErrors ?? [] }, requestId: 'req-1' });
  const productApi = { deactivateProducts: call, deleteProducts: call };
  const accessScope = {
    assertShopAllowed: jest.fn((scope: { allShops: boolean; shopIds: string[] }, shopId: string) => {
      if (!scope.allShops && !scope.shopIds.includes(shopId)) throw new PodShopForbiddenException();
    }),
  };
  const lock = {
    withLock: jest.fn(async (_key: string, _ttl: number, task: () => Promise<unknown>) =>
      overrides.lockBusy ? null : task(),
    ),
  };
  const mapper = { toDetail: jest.fn((product: unknown) => ({ detail: product })) };

  const service = new PodProductLifecycleService(
    repo as never,
    syncRepo as never,
    syncService as never,
    catalog as never,
    productApi as never,
    accessScope as never,
    lock as never,
    mapper as never,
  );
  return { service, repo, syncService, productApi, lock };
}

const ADMIN = { allShops: true, accountIds: [], shopIds: [] };
const SELLER_OTHER_SHOP = { allShops: false, accountIds: [], shopIds: ['shop-b'] };

describe('PodProductLifecycleService.deactivate', () => {
  it('gọi Deactivate Products đúng sản phẩm, rồi đồng bộ lại, rồi ghi deactivated_at', async () => {
    const { service, repo, syncService, productApi } = buildService();

    await service.deactivate(ORG, USER, PRODUCT.id, ADMIN);

    expect(productApi.deactivateProducts).toHaveBeenCalledWith(expect.anything(), ['TT-1']);
    expect(syncService.syncShop).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tiktokProductId: 'TT-1', triggeredBy: USER }),
    );
    // Thứ tự: đồng bộ (xoá dấu) TRƯỚC, đặt dấu SAU — nếu ngược lại dấu bị đồng bộ xoá mất.
    const syncOrder = syncService.syncShop.mock.invocationCallOrder[0];
    const markOrder = repo.markDeactivated.mock.invocationCallOrder[0];
    expect(syncOrder).toBeLessThan(markOrder);
    expect(repo.markDeactivated).toHaveBeenCalledWith(ORG, PRODUCT.id, USER);
  });

  it('TikTok ném lỗi ⇒ 400 POD_PRODUCT_DEACTIVATE_REJECTED, database KHÔNG đổi', async () => {
    const { service, repo, syncService } = buildService({ tiktokThrows: true });

    await expect(service.deactivate(ORG, USER, PRODUCT.id, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.markDeactivated).not.toHaveBeenCalled();
    expect(syncService.syncShop).not.toHaveBeenCalled();
  });

  it('TikTok trả code 0 nhưng errors[] có phần tử ⇒ vẫn là từ chối', async () => {
    const { service, repo } = buildService({ tiktokErrors: [{ code: 12052400, message: 'Không được phép' }] });

    await expect(service.deactivate(ORG, USER, PRODUCT.id, ADMIN)).rejects.toMatchObject({
      response: { code: 'POD_PRODUCT_DEACTIVATE_REJECTED', tiktokCode: '12052400' },
    });
    expect(repo.markDeactivated).not.toHaveBeenCalled();
  });

  it('Seller không được gán shop của sản phẩm ⇒ 403, không gọi TikTok', async () => {
    const { service, productApi } = buildService();

    await expect(service.deactivate(ORG, USER, PRODUCT.id, SELLER_OTHER_SHOP)).rejects.toBeInstanceOf(
      PodShopForbiddenException,
    );
    expect(productApi.deactivateProducts).not.toHaveBeenCalled();
  });

  it('không tìm thấy sản phẩm ⇒ 404; đang có thao tác khác ⇒ 409', async () => {
    await expect(buildService({ product: null }).service.deactivate(ORG, USER, 'x', ADMIN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(buildService({ lockBusy: true }).service.deactivate(ORG, USER, PRODUCT.id, ADMIN)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('PodProductLifecycleService.remove', () => {
  it('gọi Delete Products rồi xoá mềm bản ghi', async () => {
    const { service, repo, productApi } = buildService();

    const result = await service.remove(ORG, USER, PRODUCT.id, ADMIN);

    expect(productApi.deleteProducts).toHaveBeenCalledWith(expect.anything(), ['TT-1']);
    expect(repo.softDelete).toHaveBeenCalledWith(ORG, PRODUCT.id, USER);
    expect(result).toEqual({ id: PRODUCT.id, tiktokProductId: 'TT-1', deletedOnTiktok: true });
  });

  it('TikTok từ chối ⇒ 400 POD_PRODUCT_DELETE_REJECTED, KHÔNG xoá mềm', async () => {
    const { service, repo } = buildService({ tiktokThrows: true });

    await expect(service.remove(ORG, USER, PRODUCT.id, ADMIN)).rejects.toMatchObject({
      response: { code: 'POD_PRODUCT_DELETE_REJECTED' },
    });
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it('Seller ngoài phạm vi ⇒ 403; kết nối shop hỏng ⇒ 400 POD_PRODUCT_SHOP_UNAVAILABLE', async () => {
    await expect(buildService().service.remove(ORG, USER, PRODUCT.id, SELLER_OTHER_SHOP)).rejects.toBeInstanceOf(
      PodShopForbiddenException,
    );
    await expect(buildService({ noTarget: true }).service.remove(ORG, USER, PRODUCT.id, ADMIN)).rejects.toMatchObject({
      response: { code: 'POD_PRODUCT_SHOP_UNAVAILABLE' },
    });
  });
});
