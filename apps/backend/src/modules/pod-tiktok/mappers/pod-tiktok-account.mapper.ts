import { Injectable } from '@nestjs/common';
import {
  PodTiktokAccountListItemDto,
  PodTiktokAccountResponseDto,
  PodTiktokShopDto,
} from '../dto/pod-tiktok-response.dto';
import { PodTiktokAccountWithShops } from '../types/pod-tiktok-with-relations.type';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * PodTiktokAccountMapper — Entity (Prisma) → Response DTO.
 *
 * Nguyên tắc bảo mật: KHÔNG BAO GIỜ đưa `accessTokenEnc`, `refreshTokenEnc`,
 * `shopCipherEnc` (kể cả bản đã mã hoá) vào response. Chỉ trả metadata thời hạn.
 */
@Injectable()
export class PodTiktokAccountMapper {
  toResponse(account: PodTiktokAccountWithShops): PodTiktokAccountResponseDto {
    return {
      id: account.id,
      accountName: account.accountName,
      openIdMasked: this.maskOpenId(account.openId),
      sellerName: account.sellerName,
      sellerId: account.sellerId,
      sellerFullName: account.seller?.user.fullName ?? null,
      sellerEmail: account.seller?.user.email ?? null,
      fulfillmentAccountId: account.fulfillmentAccountId,
      fulfillmentProviderName: account.fulfillmentAccount?.name ?? null,
      fulfillmentProviderType: account.fulfillmentAccount?.provider ?? null,
      fulfillmentProviderActive: account.fulfillmentAccount?.isActive ?? null,
      sellerBaseRegion: account.sellerBaseRegion,
      userType: account.userType,
      status: account.status,
      accessTokenExpiresAt: account.accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: account.refreshTokenExpiresAt.toISOString(),
      accessTokenExpired: account.accessTokenExpiresAt.getTime() <= Date.now(),
      daysUntilReauthorize: this.daysUntil(account.refreshTokenExpiresAt),
      grantedScopes: this.toScopeArray(account.grantedScopes),
      lastRefreshedAt: account.lastRefreshedAt?.toISOString() ?? null,
      lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
      lastErrorCode: account.lastErrorCode,
      lastErrorMessage: account.lastErrorMessage,
      shops: account.shops.map((shop) => this.toShopDto(shop)),
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  toListItem(account: PodTiktokAccountWithShops): PodTiktokAccountListItemDto {
    const primaryShop = account.shops[0];
    return {
      id: account.id,
      accountName: account.accountName,
      sellerName: account.sellerName,
      sellerId: account.sellerId,
      sellerFullName: account.seller?.user.fullName ?? null,
      sellerEmail: account.seller?.user.email ?? null,
      fulfillmentAccountId: account.fulfillmentAccountId,
      fulfillmentProviderName: account.fulfillmentAccount?.name ?? null,
      fulfillmentProviderType: account.fulfillmentAccount?.provider ?? null,
      fulfillmentProviderActive: account.fulfillmentAccount?.isActive ?? null,
      shopName: primaryShop?.name ?? null,
      tiktokShopId: primaryShop?.tiktokShopId ?? null,
      region: primaryShop?.region ?? account.sellerBaseRegion,
      shopCount: account.shops.length,
      status: account.status,
      accessTokenExpiresAt: account.accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: account.refreshTokenExpiresAt.toISOString(),
      accessTokenExpired: account.accessTokenExpiresAt.getTime() <= Date.now(),
      daysUntilReauthorize: this.daysUntil(account.refreshTokenExpiresAt),
      lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
      createdAt: account.createdAt.toISOString(),
    };
  }

  private toShopDto(shop: PodTiktokAccountWithShops['shops'][number]): PodTiktokShopDto {
    return {
      id: shop.id,
      tiktokShopId: shop.tiktokShopId,
      shopCode: shop.shopCode,
      name: shop.name,
      region: shop.region,
      sellerType: shop.sellerType,
      syncEnabled: shop.syncEnabled,
      lastOrderSyncAt: shop.lastOrderSyncAt?.toISOString() ?? null,
      createdAt: shop.createdAt.toISOString(),
    };
  }

  /** Che phần giữa của open_id — đủ để đối chiếu, không lộ trọn định danh. */
  private maskOpenId(openId: string): string {
    if (openId.length <= 8) return '***';
    return `${openId.slice(0, 8)}***${openId.slice(-4)}`;
  }

  /** Số ngày còn lại (làm tròn xuống). Có thể âm nếu đã quá hạn. */
  private daysUntil(target: Date): number {
    return Math.floor((target.getTime() - Date.now()) / MS_PER_DAY);
  }

  /** `granted_scopes` lưu dạng Json — chuẩn hoá về mảng string an toàn. */
  private toScopeArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  }
}
