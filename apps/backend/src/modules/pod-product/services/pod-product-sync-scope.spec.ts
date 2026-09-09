import { PodShopForbiddenException } from '../../pod-tiktok/services/pod-access-scope.service';
import { EMPLOYEE_DEFAULT_PERMISSIONS } from '../../auth/constants/default-roles';
import { PodProductService } from './pod-product.service';

/**
 * **"Sync Now" phải bị chặn theo phạm vi shop của người bấm.**
 *
 * 🔴 Vì sao bộ test này tồn tại: quyền `pod.product.sync` trước đây bị giữ riêng cho Admin,
 * và lý do KHÔNG phải "Seller không được đồng bộ" mà là `triggerSync` nhận thẳng
 * `accountId`/`shopId` từ request rồi chuyển xuống `syncShops` — bỏ trống bộ lọc là quét MỌI
 * shop của tổ chức. Trao quyền mà không vá đường đó là leo thang đặc quyền.
 *
 * Quyền nay ĐÃ được trao cho Seller, nên những khẳng định dưới đây là thứ duy nhất giữ cho
 * việc trao quyền đó an toàn. Sai một cái là một Seller đọc được dữ liệu shop của người khác.
 */

function buildService(outcomes: unknown[] = []) {
  const syncService = { syncShops: jest.fn().mockResolvedValue(outcomes) };

  // Dùng bản thật của `PodAccessScopeService`: chính hai hàm assert này là thứ đang kiểm.
  // Thay bằng mock thì bài test chỉ khẳng định "có gọi hàm", không khẳng định nó chặn được.
  const accessScope = {
    assertShopAllowed: (scope: { allShops: boolean; shopIds: string[] }, shopId?: string | null) => {
      if (scope.allShops || !shopId) return;
      if (!scope.shopIds.includes(shopId)) throw new PodShopForbiddenException();
    },
    assertAccountAllowed: (
      scope: { allShops: boolean; accountIds: string[] },
      accountId?: string | null,
    ) => {
      if (scope.allShops || !accountId) return;
      if (!scope.accountIds.includes(accountId)) throw new PodShopForbiddenException();
    },
  };

  const service = new PodProductService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    syncService as never,
    accessScope as never,
  );

  /** Bộ lọc đã thực sự chuyển xuống tầng đồng bộ. */
  const filter = (): Record<string, unknown> =>
    (syncService.syncShops.mock.calls[0] as unknown as [Record<string, unknown>])[0];

  return { service, syncService, filter };
}

const ADMIN = { allShops: true, accountIds: [], shopIds: [] };
const SELLER = { allShops: false, accountIds: ['acc-1'], shopIds: ['shop-1', 'shop-2'] };

describe('triggerSync — phạm vi shop', () => {
  it('Admin (allShops) ⇒ KHÔNG bị giới hạn tập shop', async () => {
    const { service, filter } = buildService();

    await service.triggerSync('org-1', 'user-admin', {}, ADMIN);

    // `undefined` chứ không phải mảng rỗng: mảng rỗng nghĩa là "không shop nào".
    expect(filter().shopIds).toBeUndefined();
    expect(filter().organizationId).toBe('org-1');
  });

  it('🔴 Seller KHÔNG gửi bộ lọc ⇒ vẫn bị giới hạn đúng những shop được gán', async () => {
    // Đây là chính lỗ hổng cũ: không có bộ lọc thì `syncShops` quét cả tổ chức.
    const { service, filter } = buildService();

    await service.triggerSync('org-1', 'user-seller', {}, SELLER);

    expect(filter().shopIds).toEqual(['shop-1', 'shop-2']);
  });

  it('Seller đồng bộ MỘT shop được gán ⇒ cho phép', async () => {
    const { service, filter } = buildService();

    await service.triggerSync('org-1', 'user-seller', { shopId: 'shop-2' }, SELLER);

    expect(filter().shopId).toBe('shop-2');
    expect(filter().shopIds).toEqual(['shop-1', 'shop-2']);
  });

  it('🔴 Seller gửi shopId NGOÀI phạm vi ⇒ 403, và KHÔNG gọi tầng đồng bộ', async () => {
    const { service, syncService } = buildService();

    await expect(
      service.triggerSync('org-1', 'user-seller', { shopId: 'shop-cua-nguoi-khac' }, SELLER as never),
    ).rejects.toBeInstanceOf(PodShopForbiddenException);

    // 403 rõ ràng, chứ không phải một kết quả rỗng khó hiểu — và tuyệt đối không chạm TikTok.
    expect(syncService.syncShops).not.toHaveBeenCalled();
  });

  it('🔴 Seller gửi accountId NGOÀI phạm vi ⇒ 403', async () => {
    const { service, syncService } = buildService();

    await expect(
      service.triggerSync('org-1', 'user-seller', { accountId: 'acc-khac' }, SELLER as never),
    ).rejects.toBeInstanceOf(PodShopForbiddenException);

    expect(syncService.syncShops).not.toHaveBeenCalled();
  });

  it('Seller chưa được gán shop nào ⇒ tập rỗng, không quét gì (KHÔNG phải "không lọc")', async () => {
    const { service, filter } = buildService();

    await service.triggerSync(
      'org-1',
      'user-seller',
      {},
      { allShops: false, accountIds: [], shopIds: [] },
    );

    // 🔴 `[]` chứ không phải `undefined`. Nhầm hai giá trị này là mở toang cả tổ chức.
    expect(filter().shopIds).toEqual([]);
  });
});

describe('Quyền mặc định của Role EMPLOYEE', () => {
  it('CÓ `pod.product.sync` — Seller thấy và dùng được nút Sync Products', () => {
    expect(EMPLOYEE_DEFAULT_PERMISSIONS).toContain('pod.product.sync');
    expect(EMPLOYEE_DEFAULT_PERMISSIONS).toContain('pod.product.read');
  });

  it('🔴 KHÔNG có `pod.shop.all` — đây mới là thứ giữ Seller trong phạm vi shop được gán', () => {
    // Không có khẳng định này thì một lần "mở rộng quyền cho Seller" có thể vô tình gỡ bỏ
    // toàn bộ hàng rào phân quyền theo shop mà không ai nhận ra.
    expect(EMPLOYEE_DEFAULT_PERMISSIONS).not.toContain('pod.shop.all');
  });

  it('KHÔNG có các đường sync CHƯA được vá phạm vi', () => {
    // Hai đường này chưa nhận `PodAccessScope`. Thêm vào đây trước khi vá là lặp lại đúng
    // lỗ hổng vừa sửa.
    expect(EMPLOYEE_DEFAULT_PERMISSIONS).not.toContain('pod.tiktok.order.sync');
    expect(EMPLOYEE_DEFAULT_PERMISSIONS).not.toContain('pod.tiktok.payout.sync');
  });

  it('KHÔNG có quyền sửa/xoá sản phẩm', () => {
    expect(EMPLOYEE_DEFAULT_PERMISSIONS).not.toContain('pod.product.update');
    expect(EMPLOYEE_DEFAULT_PERMISSIONS).not.toContain('pod.product.delete');
  });
});
