import { HttpStatus } from '@nestjs/common';
import { PodProductSyncScope, PodProductSyncStatus, PodProductSyncTrigger } from '@prisma/client';
import { PodTiktokSyncInProgressException } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { PodShopForbiddenException } from '../../pod-tiktok/services/pod-access-scope.service';
import {
  PodProductNotFoundException,
  PodProductService,
  PodProductShopNotSyncableException,
  PodProductSyncFailedException,
} from './pod-product.service';
import type { ProductSyncOutcome } from './pod-product-sync.service';

/**
 * "Re-sync this product" (`POST /pod/products/:id/sync` → `resyncOne`).
 *
 * 🔴 Lỗi cũ: kết quả của `syncShop` bị BỎ QUA — lấy TikTok / ghi DB lỗi vẫn trả 200 kèm dữ liệu cũ,
 * giao diện báo thành công, "Last synced" không đổi. Kiểm: kết quả cuối cùng được trả đúng, phạm vi
 * shop chặn TRƯỚC khi gọi TikTok, đúng shop / kết nối của chính sản phẩm.
 */

const ORG = 'org-1';
const PRODUCT = {
  id: '318b7eea-84e3-4ce4-97bf-3451741b8101',
  organizationId: ORG,
  shopId: 'shop-back2y2k',
  tiktokProductId: '1732733033939571134',
};
const TARGET = { id: 'shop-back2y2k', organizationId: ORG, accountId: 'acc-t6-50', name: 'Back2Y2K' };
const ADMIN = { allShops: true, accountIds: [], shopIds: [] };
const SELLER_OTHER = { allShops: false, accountIds: ['acc-x'], shopIds: ['shop-other'] };

function outcome(overrides: Partial<ProductSyncOutcome> = {}): ProductSyncOutcome {
  return {
    shopId: TARGET.id,
    shopName: TARGET.name,
    status: PodProductSyncStatus.SUCCESS,
    scope: PodProductSyncScope.SINGLE,
    fetched: 1,
    created: 0,
    updated: 1,
    skipped: 0,
    failed: 0,
    pagesFetched: 0,
    apiCalls: 1,
    deactivated: 0,
    failures: [],
    ...overrides,
  };
}

function failure(step: 'FETCH_DETAIL' | 'MAP' | 'SAVE', errorCode: string, errorMessage: string) {
  return {
    tiktokProductId: PRODUCT.tiktokProductId,
    productId: PRODUCT.id,
    title: 'Cocteau Twins T-Shirt',
    step,
    errorCode,
    errorMessage,
    httpStatus: null,
    tiktokRequestId: step === 'FETCH_DETAIL' ? 'req-1' : null,
    retryable: true,
    attempts: step === 'SAVE' ? 2 : 1,
    failedAt: new Date().toISOString(),
  };
}

function build(result: ProductSyncOutcome = outcome(), opts: { product?: unknown; targets?: unknown[] } = {}) {
  const repo = {
    findById: jest.fn().mockResolvedValue('product' in opts ? opts.product : PRODUCT),
  };
  const syncRepo = { findSyncTargets: jest.fn().mockResolvedValue(opts.targets ?? [TARGET]) };
  const mapper = { toDetail: jest.fn((row: { id: string }) => ({ id: row.id, fresh: true })) };
  const syncService = { syncShop: jest.fn().mockResolvedValue(result) };
  const accessScope = {
    assertShopAllowed: (scope: { allShops: boolean; shopIds: string[] }, shopId?: string | null) => {
      if (scope.allShops || !shopId) return;
      if (!scope.shopIds.includes(shopId)) throw new PodShopForbiddenException();
    },
  };
  const service = new PodProductService(
    {} as never,
    repo as never,
    syncRepo as never,
    mapper as never,
    syncService as never,
    accessScope as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, repo, syncRepo, syncService, mapper };
}

describe('resyncOne — "Re-sync this product"', () => {
  it('🔴 TC1/TC7 thành công ⇒ đồng bộ ĐÚNG sản phẩm, ĐÚNG shop / kết nối của nó, trả dữ liệu ĐỌC LẠI sau khi ghi', async () => {
    const { service, repo, syncRepo, syncService } = build();

    const detail = await service.resyncOne(ORG, 'user-1', PRODUCT.id, ADMIN);

    expect(syncRepo.findSyncTargets).toHaveBeenCalledWith({ organizationId: ORG, shopId: PRODUCT.shopId });
    expect(syncService.syncShop).toHaveBeenCalledWith(TARGET, {
      trigger: PodProductSyncTrigger.MANUAL,
      triggeredBy: 'user-1',
      tiktokProductId: PRODUCT.tiktokProductId,
    });
    // Đọc lại từ DB SAU khi lượt đồng bộ trả về (lượt SINGLE chạy đồng bộ — không trả trước khi ghi xong).
    expect(repo.findById).toHaveBeenCalledTimes(2);
    expect(repo.findById.mock.invocationCallOrder[1]).toBeGreaterThan(
      syncService.syncShop.mock.invocationCallOrder[0],
    );
    expect(detail).toEqual({ id: PRODUCT.id, fresh: true });
  });

  it('dữ liệu TikTok không đổi (SKIPPED) ⇒ thành công, không phải lỗi', async () => {
    const { service } = build(outcome({ updated: 0, skipped: 1 }));

    await expect(service.resyncOne(ORG, 'u', PRODUCT.id, ADMIN as never)).resolves.toBeDefined();
  });

  it('🔴 TC4 TikTok lỗi ⇒ 502 POD_PRODUCT_SYNC_FAILED kèm mã + request id, KHÔNG trả dữ liệu cũ như thành công', async () => {
    const { service, mapper } = build(
      outcome({ updated: 0, failed: 1, failures: [failure('FETCH_DETAIL', '12052700', 'seller inactive')] }),
    );

    const error = await service.resyncOne(ORG, 'u', PRODUCT.id, ADMIN as never).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PodProductSyncFailedException);
    const ex = error as PodProductSyncFailedException;
    expect(ex.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    const body = ex.getResponse() as { code: string; message: string; details: Record<string, unknown> };
    expect(body.code).toBe('POD_PRODUCT_SYNC_FAILED');
    expect(body.message).toContain('12052700');
    expect(body.message).toContain('seller inactive');
    expect(body.details).toMatchObject({ step: 'FETCH_DETAIL', tiktokRequestId: 'req-1' });
    expect(mapper.toDetail).not.toHaveBeenCalled();
  });

  it('🔴 TC5 ghi DB lỗi (transaction hết giờ) ⇒ 500, thông điệp nói rõ bước GHI + mã Prisma', async () => {
    const { service } = build(
      outcome({ updated: 0, failed: 1, failures: [failure('SAVE', 'P2028', 'Transaction already closed')] }),
    );

    const error = (await service
      .resyncOne(ORG, 'u', PRODUCT.id, ADMIN as never)
      .catch((e: unknown) => e)) as PodProductSyncFailedException;

    expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect((error.getResponse() as { message: string }).message).toMatch(/ghi dữ liệu.*P2028/);
  });

  it('lỗi cấp shop (token / kết nối) ⇒ 502 với thông điệp của lượt', async () => {
    const { service } = build(
      outcome({ status: PodProductSyncStatus.FAILED, updated: 0, errorMessage: 'Không lấy được access token' }),
    );

    const error = (await service
      .resyncOne(ORG, 'u', PRODUCT.id, ADMIN as never)
      .catch((e: unknown) => e)) as PodProductSyncFailedException;

    expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect((error.getResponse() as { message: string }).message).toContain('Không lấy được access token');
  });

  it('🔴 TC12 đang có lượt đồng bộ khác của shop (khoá Redis) ⇒ 409, không báo thành công giả', async () => {
    const { service } = build(outcome({ status: 'LOCKED', fetched: 0, updated: 0 }));

    await expect(service.resyncOne(ORG, 'u', PRODUCT.id, ADMIN as never)).rejects.toBeInstanceOf(
      PodTiktokSyncInProgressException,
    );
  });

  it('🔴 TC6 id không tồn tại trong tổ chức ⇒ 404, không gọi TikTok', async () => {
    const { service, syncService } = build(outcome(), { product: null });

    await expect(service.resyncOne(ORG, 'u', PRODUCT.id, ADMIN as never)).rejects.toBeInstanceOf(
      PodProductNotFoundException,
    );
    expect(syncService.syncShop).not.toHaveBeenCalled();
  });

  it('🔴 Seller ngoài phạm vi shop ⇒ 403 TRƯỚC khi gọi TikTok / ghi DB', async () => {
    const { service, syncService, syncRepo } = build();

    await expect(service.resyncOne(ORG, 'u', PRODUCT.id, SELLER_OTHER as never)).rejects.toBeInstanceOf(
      PodShopForbiddenException,
    );
    expect(syncRepo.findSyncTargets).not.toHaveBeenCalled();
    expect(syncService.syncShop).not.toHaveBeenCalled();
  });

  it('shop không đủ điều kiện (INACTIVE / kết nối hỏng) ⇒ 409 rõ ràng thay vì 404 "không tìm thấy sản phẩm"', async () => {
    const { service, syncService } = build(outcome(), { targets: [] });

    await expect(service.resyncOne(ORG, 'u', PRODUCT.id, ADMIN as never)).rejects.toBeInstanceOf(
      PodProductShopNotSyncableException,
    );
    expect(syncService.syncShop).not.toHaveBeenCalled();
  });
});
