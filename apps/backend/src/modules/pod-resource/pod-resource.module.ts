import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PodListingModule } from '../pod-listing/pod-listing.module';
import { PodResourceController } from './pod-resource.controller';
import { PodResourceSyncService } from './services/pod-resource-sync.service';

/**
 * PodResourceModule — **Resource Synchronization** của một TỔ CHỨC.
 *
 * Kéo kho hàng TikTok của các shop trong tổ chức về cache và giữ trạng thái từng lượt để
 * màn hình Resources hiển thị.
 *
 * 🔴 Danh mục / thương hiệu / thuộc tính đã chuyển sang `PodMasterDataModule` (dữ liệu master
 * toàn cục, chỉ Super Admin đồng bộ). Vì thế module này không còn phụ thuộc `PodProductModule`.
 *
 * Phụ thuộc một chiều:
 *   `PodResourceModule → PodListingModule` (đồng bộ kho)
 */
@Module({
  imports: [AuthModule, PodListingModule],
  controllers: [PodResourceController],
  providers: [PodResourceSyncService],
  exports: [PodResourceSyncService],
})
export class PodResourceModule {}
