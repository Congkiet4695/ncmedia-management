import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PodProductModule } from '../pod-product/pod-product.module';
import { PodTiktokModule } from '../pod-tiktok/pod-tiktok.module';
import { PodMasterDataController } from './pod-master-data.controller';
import { PodMasterDataSyncService } from './services/pod-master-data-sync.service';

/**
 * PodMasterDataModule — **TikTok Master Data TOÀN CỤC** (Categories / Brands / Category
 * Attributes).
 *
 * 🔴 Vì sao là module riêng chứ không nằm trong `PodResourceModule`: hai module trả lời hai
 * câu hỏi khác nhau và có ranh giới quyền ngược nhau.
 *
 *   - `PodResourceModule` → tài nguyên **của một tổ chức** (kho hàng theo shop). Org admin
 *     đồng bộ được.
 *   - `PodMasterDataModule` → dữ liệu **dùng chung toàn nền tảng**. CHỈ Super Admin ghi.
 *
 * Trộn chung nghĩa là một controller mang hai bộ guard mâu thuẫn, và chỉ cần một lần thêm
 * endpoint cẩu thả là org admin ghi được vào dữ liệu của mọi tổ chức khác.
 *
 * Phụ thuộc một chiều:
 *   `PodMasterDataModule → PodProductModule` (upsert danh mục / thương hiệu / thuộc tính)
 *   `PodMasterDataModule → PodTiktokModule`  (khoá phân tán chống chạy chồng)
 */
@Module({
  imports: [AuthModule, PodProductModule, PodTiktokModule],
  controllers: [PodMasterDataController],
  providers: [PodMasterDataSyncService],
  exports: [PodMasterDataSyncService],
})
export class PodMasterDataModule {}
