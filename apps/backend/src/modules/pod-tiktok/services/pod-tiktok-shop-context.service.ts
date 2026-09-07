import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import { PodTiktokTokenService } from './pod-tiktok-token.service';
import { TiktokEncryptionService } from './tiktok-encryption.service';

/** Không dựng được ngữ cảnh gọi API của shop (shop đã gỡ, token hỏng, hết hạn uỷ quyền). */
export class PodTiktokShopContextException extends Error {
  constructor(
    message: string,
    /** Lý do máy đọc được — nơi gọi dùng để quyết định có retry hay không. */
    readonly reason: 'SHOP_NOT_FOUND' | 'TOKEN_UNAVAILABLE',
  ) {
    super(message);
    this.name = 'PodTiktokShopContextException';
  }
}

/**
 * PodTiktokShopContextService — dựng `{ accessToken, shopCipher }` cho MỘT shop.
 *
 * 🔴 Mọi API nhóm Shop của TikTok (Product, Order, Fulfillment, **Promotion**) đều cần đủ
 * hai thứ đó, và cả hai đều được mã hoá at-rest. Đặt ở `pod-tiktok` vì đây là module sở hữu
 * bảng `pod_tiktok_accounts` / `pod_tiktok_shops` lẫn khoá giải mã — module nghiệp vụ không
 * nên biết token nằm ở cột nào, càng không nên tự gọi lớp giải mã.
 *
 * 🔴 **Gọi MỘT lần cho mỗi shop rồi dùng lại trong suốt một lượt xử lý.** Hàm này có thể
 * kích hoạt refresh token; gọi nó trong vòng lặp 300 dòng sản phẩm là tự tạo ra 300 lượt
 * kiểm tra token cho đúng một shop.
 */
@Injectable()
export class PodTiktokShopContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: PodTiktokTokenService,
    private readonly encryption: TiktokEncryptionService,
  ) {}

  /**
   * Ngữ cảnh gọi API của một shop trong MỘT tổ chức.
   *
   * `organizationId` là tham số bắt buộc, không phải tuỳ chọn: đây là hàng rào tenant
   * (ADR-004) — thiếu nó thì một id shop đoán được là đủ để mượn token của tổ chức khác.
   */
  async resolve(organizationId: string, shopId: string): Promise<TiktokShopContext> {
    const shop = await this.prisma.podTiktokShop.findFirst({
      where: { id: shopId, organizationId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        shopCipherEnc: true,
        account: {
          select: {
            id: true,
            organizationId: true,
            accountName: true,
            accessTokenEnc: true,
            accessTokenExpiresAt: true,
            refreshTokenEnc: true,
            refreshTokenExpiresAt: true,
          },
        },
      },
    });
    if (!shop) {
      throw new PodTiktokShopContextException(
        'Shop không tồn tại trong tổ chức này hoặc đã bị gỡ liên kết.',
        'SHOP_NOT_FOUND',
      );
    }

    const token = await this.tokenService.ensureValidAccessToken(shop.account);
    if (!token.ok) {
      throw new PodTiktokShopContextException(
        `Không lấy được access token của shop (${token.reason}): ${token.message}`,
        'TOKEN_UNAVAILABLE',
      );
    }

    return {
      accessToken: token.accessToken,
      shopCipher: this.encryption.decrypt(shop.shopCipherEnc),
      shopId: shop.id,
      organizationId: shop.organizationId,
    };
  }
}
