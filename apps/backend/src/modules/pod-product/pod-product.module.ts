import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { PodTiktokModule } from '../pod-tiktok/pod-tiktok.module';
import { PodProductController } from './pod-product.controller';
import { PodProductMapper } from './mappers/pod-product.mapper';
import { PodProductResponseMapper } from './mappers/pod-product-response.mapper';
import { PodProductRepository } from './repositories/pod-product.repository';
import { PodProductSyncRepository } from './repositories/pod-product-sync.repository';
import { PodProductSyncJob } from './schedulers/pod-product-sync.job';
import { PodProductCatalogService } from './services/pod-product-catalog.service';
import { PodProductService } from './services/pod-product.service';
import { PodProductSyncService } from './services/pod-product-sync.service';

/**
 * PodProductModule — Sprint 2: **Product Synchronization** (TikTok → NCMedia).
 *
 * Phạm vi: CHỈ ĐỌC. Không tạo/sửa/xoá/publish sản phẩm trên TikTok.
 *
 * Phụ thuộc (một chiều):
 *  - `TikTokSdkModule` (@Global) — cửa duy nhất ra SDK TikTok.
 *  - `PodTiktokModule` — dùng lại vòng đời token, giải mã credential, khoá phân tán.
 *    KHÔNG có chiều ngược lại: module POD TikTok không biết gì về Product.
 *
 * Phân lớp giữ đúng khuôn của module POD hiện có:
 *   controller → service → repository, mapper là ACL, scheduler chỉ kích hoạt.
 */
@Module({
  imports: [AuthModule, PodTiktokModule, ScheduleModule.forRoot()],
  controllers: [PodProductController],
  providers: [
    PodProductService,
    PodProductSyncService,
    PodProductCatalogService,
    PodProductRepository,
    PodProductSyncRepository,
    PodProductMapper,
    PodProductResponseMapper,
    PodProductSyncJob,
  ],
  exports: [
    // Sprint 3 (Template) và Sprint Listing sẽ đọc lại dữ liệu sản phẩm từ đây.
    PodProductRepository,
    PodProductService,
  ],
})
export class PodProductModule {}
