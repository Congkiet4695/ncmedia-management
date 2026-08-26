import { Injectable, Logger } from '@nestjs/common';

/** Một việc cần chạy SAU khi đơn TikTok được đồng bộ về. */
export interface OrderSyncHook {
  /** Tên ngắn để ghi log — không dùng cho logic. */
  readonly hookName: string;
  onOrdersSynced(context: { organizationId: string }): Promise<void>;
}

/**
 * OrderSyncHookRegistry — chỗ nối giữa module POD và những module cần biết "đơn vừa về".
 *
 * 🔴 **Vì sao cần một registry thay vì gọi thẳng.** Quan hệ phụ thuộc giữa hai module là MỘT
 * CHIỀU: `Fulfillment → PodTiktok`. Để `PodOrderSyncService` gọi được service của Fulfillment
 * thì PodTiktok phải import FulfillmentModule — tạo vòng phụ thuộc Nest và làm hỏng cả hai
 * module. Registry đảo chiều phụ thuộc: PodTiktok chỉ biết một giao diện trung lập ở
 * `common/`, còn Fulfillment tự đăng ký mình vào lúc khởi động.
 *
 * Đặt ở `common/` và `@Global()` (xem `SyncHooksModule`) vì đây là hạ tầng nối module, không
 * thuộc nghiệp vụ của bên nào.
 *
 * 🔴 **Hook KHÔNG được làm hỏng việc đồng bộ đơn.** Đồng bộ đơn là nghiệp vụ chính; ánh xạ tự
 * động là tiện ích chạy kèm. Mọi lỗi của hook đều bị bắt và chỉ ghi log — một API key
 * fulfillment hết hạn không có lý do gì làm đơn TikTok ngừng về.
 */
@Injectable()
export class OrderSyncHookRegistry {
  private readonly logger = new Logger(OrderSyncHookRegistry.name);
  private readonly hooks: OrderSyncHook[] = [];

  register(hook: OrderSyncHook): void {
    // Nest dựng provider một lần cho mỗi module nên trùng lặp không xảy ra trong thực tế;
    // kiểm tra ở đây để một lần đăng ký nhầm không biến thành chạy hai lần mỗi lượt đồng bộ.
    if (this.hooks.some((existing) => existing.hookName === hook.hookName)) return;
    this.hooks.push(hook);
  }

  /**
   * Chạy mọi hook sau một lượt đồng bộ đơn.
   *
   * Chạy TUẦN TỰ, không song song: các hook đều ghi vào cùng những bảng của module
   * fulfillment, và số hook luôn rất nhỏ nên song song không mua được gì ngoài rủi ro khoá.
   */
  async notifyOrdersSynced(context: { organizationId: string }): Promise<void> {
    for (const hook of this.hooks) {
      try {
        await hook.onOrdersSynced(context);
      } catch (error) {
        this.logger.warn({
          module: 'common',
          operation: 'orderSyncHook',
          hook: hook.hookName,
          organizationId: context.organizationId,
          msg: `Hook sau đồng bộ đơn thất bại (đã bỏ qua): ${(error as Error).message}`,
        });
      }
    }
  }
}
