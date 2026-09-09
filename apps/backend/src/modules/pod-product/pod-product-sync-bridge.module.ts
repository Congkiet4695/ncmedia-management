import { Global, Module } from '@nestjs/common';
import { PRODUCT_SYNC_TRIGGER } from '../pod-tiktok/shared/product-sync-trigger';
import { PodProductModule } from './pod-product.module';
import { PodProductSyncService } from './services/pod-product-sync.service';

/**
 * PodProductSyncBridgeModule — nối `PRODUCT_SYNC_TRIGGER` với `PodProductSyncService`.
 *
 * 🔴 Vì sao là một module riêng và `@Global()`:
 *
 * `PodTiktokModule` cần kích hoạt đồng bộ sản phẩm ngay sau khi Seller liên kết gian hàng,
 * nhưng chiều phụ thuộc là `PodProductModule → PodTiktokModule`. Nếu `PodTiktokModule` import
 * ngược `PodProductModule` thì thành vòng.
 *
 * Cầu nối này cắt vòng đó: nó import `PodProductModule` (chiều thuận, không tạo vòng) rồi
 * công bố binding ở phạm vi TOÀN CỤC, nên `PodTiktokModule` tiêm được token mà **không phải
 * import gì cả**. Cùng cơ chế `TikTokSdkModule` đang dùng — không dựng kỹ thuật mới.
 *
 * 🔴 Đây là chỗ DUY NHẤT biết cả hai phía. Thêm một nơi khác cần kích hoạt đồng bộ thì tiêm
 * cùng token này, KHÔNG viết một service đồng bộ thứ hai.
 */
@Global()
@Module({
  imports: [PodProductModule],
  providers: [{ provide: PRODUCT_SYNC_TRIGGER, useExisting: PodProductSyncService }],
  exports: [PRODUCT_SYNC_TRIGGER],
})
export class PodProductSyncBridgeModule {}
