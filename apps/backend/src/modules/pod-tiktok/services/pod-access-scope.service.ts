import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';

/**
 * Quyền xem dữ liệu POD của MỌI shop trong tổ chức.
 *
 * 🔴 Dùng PERMISSION chứ không so mã role. Role là động (ADR-009): tổ chức có thể tạo thêm
 * role "Trưởng nhóm" cần thấy mọi shop, và so `role === 'ADMIN'` sẽ khoá cứng khả năng đó.
 * Quyền này nằm trong catalog nên ADMIN nhận tự động khi seed, còn EMPLOYEE thì không.
 */
export const POD_SHOP_ALL_PERMISSION = 'pod.shop.all';

/**
 * Phạm vi dữ liệu POD của một người dùng.
 *
 * `allShops = true`  ⇒ không lọc gì (Admin, hoặc role được cấp `pod.shop.all`).
 * `allShops = false` ⇒ CHỈ được thấy `shopIds` / `accountIds` liệt kê. Mảng RỖNG là hợp lệ và
 *                      có nghĩa "chưa được gán shop nào" ⇒ mọi truy vấn phải trả về rỗng,
 *                      KHÔNG phải trả về tất cả.
 */
export interface PodAccessScope {
  allShops: boolean;
  /** TikTok Account đã được Admin gán cho người dùng này. */
  accountIds: string[];
  /** Shop thuộc các account trên. */
  shopIds: string[];
}

/**
 * Phạm vi dành cho TIẾN TRÌNH NỀN (scheduler, webhook, job) — không có người dùng nào.
 *
 * 🔴 Chỉ dùng ở nơi KHÔNG bắt nguồn từ một request của người dùng. Dùng nó để "cho qua" một
 * endpoint là vô hiệu hoá toàn bộ phân quyền theo shop — nếu thấy hằng số này trong một
 * controller, đó là bug.
 */
export const POD_SCOPE_SYSTEM: PodAccessScope = Object.freeze({
  allShops: true,
  accountIds: [],
  shopIds: [],
});

/**
 * PodAccessScopeService — trả lời đúng MỘT câu hỏi: "người này được đụng vào shop nào?".
 *
 * ```
 *   User ──(1-1)──▶ Employee ──(seller_id)──▶ PodTiktokAccount ──▶ PodTiktokShop
 * ```
 *
 * 🔴 **Một nguồn sự thật cho mọi module POD.** Mỗi module tự viết một phép lọc riêng là cách
 * chắc chắn nhất để một trong số đó bị bỏ sót — và bỏ sót ở đây nghĩa là seller nhìn thấy đơn
 * hàng, doanh thu và sản phẩm của người khác. Đặt ở `pod-tiktok` vì bảng nguồn
 * (`pod_tiktok_accounts.seller_id`) thuộc module này; các module POD khác vốn đã phụ thuộc
 * một chiều vào nó nên không phát sinh vòng phụ thuộc.
 *
 * 🔴 **Mặc định là TỪ CHỐI.** Ai không có `pod.shop.all` đều bị giới hạn theo shop được gán,
 * kể cả role tuỳ biến do tổ chức tự tạo. Thêm một role mới mà quên cấp quyền thì hậu quả là
 * "không thấy gì" — chứ không phải "thấy hết".
 */
@Injectable()
export class PodAccessScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Phạm vi của người dùng hiện tại.
   *
   * MỘT truy vấn cho toàn bộ phạm vi. Kết quả nên được nạp một lần cho mỗi request rồi
   * truyền xuống các tầng dưới, không gọi lại trong vòng lặp.
   */
  async resolve(user: AuthenticatedUser): Promise<PodAccessScope> {
    if (await this.hasAllShopAccess(user)) {
      return { allShops: true, accountIds: [], shopIds: [] };
    }

    const accounts = await this.prisma.podTiktokAccount.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        // `seller_id` trỏ tới Employee, không phải User — đi qua quan hệ 1-1 để không phải
        // giả định hai id bằng nhau.
        seller: { userId: user.userId, organizationId: user.organizationId },
      },
      select: { id: true, shops: { where: { deletedAt: null }, select: { id: true } } },
    });

    return {
      allShops: false,
      accountIds: accounts.map((account) => account.id),
      shopIds: accounts.flatMap((account) => account.shops.map((shop) => shop.id)),
    };
  }

  /**
   * Chặn thao tác trên một shop nằm ngoài phạm vi.
   *
   * 🔴 Dùng ở MỌI đường ghi và mọi endpoint nhận `shopId` từ client. Lọc danh sách là chưa
   * đủ: người dùng vẫn có thể đoán id và gọi thẳng API.
   */
  assertShopAllowed(scope: PodAccessScope, shopId: string | null | undefined): void {
    if (scope.allShops || !shopId) return;
    if (!scope.shopIds.includes(shopId)) throw new PodShopForbiddenException();
  }

  /** Chặn thao tác trên một TikTok Account nằm ngoài phạm vi. */
  assertAccountAllowed(scope: PodAccessScope, accountId: string | null | undefined): void {
    if (scope.allShops || !accountId) return;
    if (!scope.accountIds.includes(accountId)) throw new PodShopForbiddenException();
  }

  /**
   * Điều kiện Prisma cho cột `shopId`.
   *
   * Trả `undefined` khi không phải lọc, để nơi gọi trải vào `where` mà không đẻ nhánh if.
   * Đã có bộ lọc `shopId` do người dùng chọn thì bộ lọc đó phải được kiểm bằng
   * `assertShopAllowed` TRƯỚC — hai việc khác nhau, không gộp.
   */
  shopFilter(scope: PodAccessScope): { in: string[] } | undefined {
    return scope.allShops ? undefined : { in: scope.shopIds };
  }

  /** Điều kiện Prisma cho cột `accountId`. */
  accountFilter(scope: PodAccessScope): { in: string[] } | undefined {
    return scope.allShops ? undefined : { in: scope.accountIds };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Người dùng có quyền xem mọi shop không.
   *
   * Đọc từ `role_permissions` giống hệt `PermissionsGuard` — cùng một nguồn, nên quyền cấp ở
   * màn hình quản trị Role có hiệu lực ngay, không cần đăng nhập lại.
   */
  private async hasAllShopAccess(user: AuthenticatedUser): Promise<boolean> {
    const granted = await this.prisma.rolePermission.findFirst({
      where: {
        deletedAt: null,
        role: { organizationId: user.organizationId, code: user.role, deletedAt: null },
        permission: { code: POD_SHOP_ALL_PERMISSION },
      },
      select: { id: true },
    });
    return granted !== null;
  }
}

/**
 * Truy cập dữ liệu của shop không được gán.
 *
 * Cố ý KHÔNG nói rõ shop đó có tồn tại hay không — trả lời "không tồn tại" cho id lạ và
 * "không có quyền" cho id thật là tự biến API thành công cụ dò id của tổ chức khác.
 */
export class PodShopForbiddenException extends ForbiddenException {
  constructor() {
    super({
      code: 'POD_SHOP_FORBIDDEN',
      message:
        'Bạn chỉ thao tác được trên những TikTok Shop đã được Admin gán. ' +
        'Liên hệ Admin nếu cần thêm quyền truy cập shop này.',
    });
  }
}
