import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import { shopScopeFilter } from '../../pod-tiktok/shared/shop-scope';
import { PodTiktokTokenService } from '../../pod-tiktok/services/pod-tiktok-token.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { PodProductSyncRepository } from '../../pod-product/repositories/pod-product-sync.repository';
import { TikTokSdkService } from '../../tiktok-sdk/tiktok-sdk.service';
import { TIKTOK_SDK_CONTENT_TYPE } from '../../tiktok-sdk/tiktok-sdk.constants';
import { POD_WAREHOUSE_DERIVE_SAMPLE } from '../constants/pod-listing.constants';

/** Kho hàng do TikTok trả về (chỉ các trường hệ thống dùng). */
interface TiktokWarehouse {
  id?: string;
  name?: string;
  type?: string;
  subType?: string;
  effectStatus?: string;
  isDefault?: boolean;
  /** Địa chỉ do SDK trả về — chỉ đọc `regionCode`, phần còn lại lưu nguyên trạng. */
  address?: { regionCode?: string };
}

/**
 * PodWarehouseService — đồng bộ và tra cứu kho hàng TikTok.
 *
 * 🔴 Không hardcode kho: danh sách đến từ `Get Warehouse List` (logistics/202309) qua SDK.
 * Người dùng chỉ CHỌN kho ở Listing Template.
 *
 * Gọi SDK trực tiếp qua `TikTokSdkService.execute` vì đây là API nhóm `logistics`, không
 * thuộc `TiktokProductApiService` — vẫn đi qua đúng một cửa duy nhất ra TikTok.
 */
@Injectable()
export class PodWarehouseService {
  private readonly logger = new Logger(PodWarehouseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sdk: TikTokSdkService,
    private readonly syncRepo: PodProductSyncRepository,
    private readonly tokenService: PodTiktokTokenService,
    private readonly encryption: TiktokEncryptionService,
  ) {}

  /** Danh sách kho đã đồng bộ (đổ vào dropdown của Listing Template). */
  list(organizationId: string, params: { shopId?: string } = {}, scope?: PodAccessScope) {
    return this.prisma.podTiktokWarehouse.findMany({
      where: {
        organizationId,
        deletedAt: null,
        // Kho gắn với TỪNG shop, nên nó là dữ liệu theo shop chứ không phải danh mục chung:
        // Seller chỉ thấy kho của shop mình. `scope` để tuỳ chọn cho tiến trình nền.
        shopId: shopScopeFilter(
          scope && !scope.allShops ? scope.shopIds : undefined,
          params.shopId,
        ),
      },
      include: { shop: { select: { id: true, name: true, region: true } } },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Đồng bộ kho cho các shop đủ điều kiện.
   *
   * Fail-soft theo shop: một shop lỗi token không được chặn các shop còn lại — nhưng lỗi
   * đó **được trả về** chứ không nuốt. Nuốt lỗi là lý do màn hình báo "đồng bộ xong" trong
   * khi thực tế không kéo được gì.
   */
  async sync(filter: {
    organizationId?: string;
    accountId?: string;
    shopId?: string;
  }): Promise<WarehouseSyncOutcome[]> {
    const targets = await this.syncRepo.findSyncTargets(filter);
    const results: WarehouseSyncOutcome[] = [];

    for (const target of targets) {
      try {
        const token = await this.tokenService.ensureValidAccessToken(target.account);
        if (!token.ok) {
          this.logger.warn({
            module: 'pod-listing',
            operation: 'warehouse.sync.skip',
            organizationId: target.organizationId,
            shopId: target.id,
            reason: token.reason,
            msg: 'Bỏ qua shop vì không lấy được access token',
          });
          results.push({
            shopId: target.id,
            shopName: target.name,
            warehouses: 0,
            error: `Không lấy được access token (${token.reason}): ${token.message}`,
          });
          continue;
        }

        const shopCipher = this.encryption.decrypt(target.shopCipherEnc);
        const { data } = await this.sdk.execute<{ warehouses?: TiktokWarehouse[] }>({
          endpoint: 'LOGISTICS_WAREHOUSES_GET',
          invoke: () =>
            this.sdk.api.LogisticsV202309Api.WarehousesGet(
              token.accessToken,
              TIKTOK_SDK_CONTENT_TYPE,
              shopCipher,
            ),
        });

        const warehouses = data.warehouses ?? [];
        for (const warehouse of warehouses) {
          if (!warehouse.id) continue;
          const row = {
            name: warehouse.name ?? null,
            type: warehouse.type ?? null,
            subType: warehouse.subType ?? null,
            effectStatus: warehouse.effectStatus ?? null,
            isDefault: warehouse.isDefault ?? false,
            regionCode: warehouse.address?.regionCode ?? null,
            address: (warehouse.address ?? {}) as unknown as Prisma.InputJsonValue,
          };

          await this.prisma.podTiktokWarehouse.upsert({
            where: {
              shopId_tiktokWarehouseId: {
                shopId: target.id,
                tiktokWarehouseId: warehouse.id,
              },
            },
            create: {
              organizationId: target.organizationId,
              shopId: target.id,
              tiktokWarehouseId: warehouse.id,
              ...row,
            },
            update: { ...row, syncedAt: new Date(), deletedAt: null },
          });
        }

        results.push({
          shopId: target.id,
          shopName: target.name,
          warehouses: warehouses.length,
        });
        this.logger.log({
          module: 'pod-listing',
          operation: 'warehouse.sync',
          organizationId: target.organizationId,
          shopId: target.id,
          warehouses: warehouses.length,
          msg: 'Đã đồng bộ kho hàng',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Lỗi không xác định';
        this.logger.error({
          module: 'pod-listing',
          operation: 'warehouse.sync.fail',
          organizationId: target.organizationId,
          shopId: target.id,
          msg: message,
        });

        // Nguồn dự phòng: rút `warehouse_id` từ chính sản phẩm đã đồng bộ của shop.
        const derived = await this.deriveFromProducts(target.organizationId, target.id);
        results.push({
          shopId: target.id,
          shopName: target.name,
          warehouses: derived,
          derived: derived > 0,
          error: message,
        });
      }
    }

    return results;
  }

  /**
   * Nguồn DỰ PHÒNG: rút `warehouse_id` ra từ sản phẩm đã đồng bộ của shop.
   *
   * 🔴 Vì sao cần: `Get Warehouse List` thuộc nhóm **Logistics**, một scope riêng. App chưa
   * được cấp scope đó thì TikTok trả `105005 Access denied` — trong khi Create Product lại
   * BẮT BUỘC có `warehouse_id`. Bế tắc đó có lối thoát vì mỗi sản phẩm đã đồng bộ đều mang
   * sẵn `skus[].inventory[].warehouse_id` của chính shop: id thật, do TikTok cấp, chỉ là đi
   * bằng cửa khác.
   *
   * Chỉ lấy được **id** — tên, loại, vùng vẫn để trống cho tới khi có scope Logistics. Đó là
   * lý do cột `name` được phép NULL và màn hình hiển thị id khi thiếu tên.
   */
  async deriveFromProducts(organizationId: string, shopId: string): Promise<number> {
    const rows = await this.prisma.podProductRawData.findMany({
      where: { organizationId, shopId },
      select: { payload: true },
      orderBy: { fetchedAt: 'desc' },
      take: POD_WAREHOUSE_DERIVE_SAMPLE,
    });

    const ids = new Set<string>();
    for (const row of rows) {
      const skus = (
        row.payload as { skus?: Array<{ inventory?: Array<{ warehouseId?: string }> }> }
      )?.skus;
      for (const sku of skus ?? []) {
        for (const inventory of sku.inventory ?? []) {
          if (inventory.warehouseId) ids.add(inventory.warehouseId);
        }
      }
    }
    if (ids.size === 0) return 0;

    for (const tiktokWarehouseId of ids) {
      await this.prisma.podTiktokWarehouse.upsert({
        where: { shopId_tiktokWarehouseId: { shopId, tiktokWarehouseId } },
        create: { organizationId, shopId, tiktokWarehouseId },
        // Không ghi đè tên/loại: lần đồng bộ chính thức sau này (khi đã có scope) phải
        // thắng, chứ không bị bản rút gọn này xoá mất dữ liệu đầy đủ.
        update: { syncedAt: new Date(), deletedAt: null },
      });
    }

    this.logger.warn({
      module: 'pod-listing',
      operation: 'warehouse.derive',
      organizationId,
      shopId,
      warehouses: ids.size,
      msg: 'Lấy warehouse_id từ sản phẩm đã đồng bộ (app chưa có scope Logistics)',
    });
    return ids.size;
  }
}

/** Kết quả đồng bộ kho của MỘT shop. `error` có giá trị ⇒ shop đó hỏng. */
export interface WarehouseSyncOutcome {
  shopId: string;
  shopName: string;
  warehouses: number;
  /** `true` ⇒ số kho ở trên đến từ nguồn dự phòng (rút từ sản phẩm), không phải API Logistics. */
  derived?: boolean;
  error?: string;
}
