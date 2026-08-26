import { Global, Module } from '@nestjs/common';
import { OrderSyncHookRegistry } from './order-sync-hook.registry';

/**
 * SyncHooksModule — hạ tầng nối các module quanh sự kiện đồng bộ.
 *
 * `@Global()` vì cả bên phát (PodTiktok) lẫn bên nghe (Fulfillment) đều cần đúng MỘT thể hiện
 * của registry; khai báo `imports` ở từng module chỉ làm rườm rà mà không đổi kết quả.
 *
 * Module này KHÔNG chứa nghiệp vụ và không được phép chứa: nó chỉ giữ danh sách hook.
 */
@Global()
@Module({
  providers: [OrderSyncHookRegistry],
  exports: [OrderSyncHookRegistry],
})
export class SyncHooksModule {}
