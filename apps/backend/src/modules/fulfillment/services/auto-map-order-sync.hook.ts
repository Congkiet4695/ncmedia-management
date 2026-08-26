import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  OrderSyncHookRegistry,
  type OrderSyncHook,
} from '../../../common/hooks/order-sync-hook.registry';
import { ProductMappingAutoService } from './product-mapping-auto.service';

/**
 * AutoMapOrderSyncHook — chạy ánh xạ tự động NGAY SAU khi đơn TikTok đồng bộ về.
 *
 * Đây là hiện thực của câu "Khi đồng bộ Order từ TikTok … nếu chưa có Mapping thì tự tìm"
 * trong yêu cầu nghiệp vụ.
 *
 * 🔴 Lớp này cố ý MỎNG: nó chỉ nối dây. Toàn bộ luật nằm ở `ProductMappingAutoService` và
 * `shared/auto-map-match.ts`, nên cùng một luật chạy được từ ba nguồn kích hoạt (sau đồng bộ
 * đơn · sau đồng bộ danh mục · người dùng bấm) mà không có bản sao nào.
 *
 * Tự đăng ký vào registry ở `onModuleInit` thay vì để `PodTiktokModule` biết đến mình — xem
 * `OrderSyncHookRegistry` về lý do chiều phụ thuộc phải như vậy.
 */
@Injectable()
export class AutoMapOrderSyncHook implements OrderSyncHook, OnModuleInit {
  readonly hookName = 'fulfillment.auto-map';

  constructor(
    private readonly registry: OrderSyncHookRegistry,
    private readonly autoMap: ProductMappingAutoService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onOrdersSynced(context: { organizationId: string }): Promise<void> {
    await this.autoMap.resolveOrganization(context.organizationId);
  }
}
