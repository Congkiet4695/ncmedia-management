import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PodListingModule } from '../pod-listing/pod-listing.module';
import { PodProductModule } from '../pod-product/pod-product.module';
import { PodResourceController } from './pod-resource.controller';
import { PodResourceSyncService } from './services/pod-resource-sync.service';

/**
 * PodResourceModule — **Resource Synchronization**.
 *
 * Kéo dữ liệu dùng chung của TikTok (danh mục, thương hiệu, thuộc tính, kho) về cache và
 * giữ trạng thái từng lượt để màn hình Resources hiển thị.
 *
 * Phụ thuộc một chiều:
 *   `PodResourceModule → PodProductModule`  (đồng bộ danh mục / thương hiệu / thuộc tính)
 *   `PodResourceModule → PodListingModule`  (đồng bộ kho)
 *
 * Không có chiều ngược lại — hai module kia không biết module này tồn tại. Nhờ vậy việc
 * thêm một tài nguyên mới cần đồng bộ chỉ đụng vào đây.
 */
@Module({
  imports: [AuthModule, PodProductModule, PodListingModule],
  controllers: [PodResourceController],
  providers: [PodResourceSyncService],
  exports: [PodResourceSyncService],
})
export class PodResourceModule {}
