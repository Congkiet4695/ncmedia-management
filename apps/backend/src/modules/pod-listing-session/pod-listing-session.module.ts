import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PodListingModule } from '../pod-listing/pod-listing.module';
import { PodTiktokModule } from '../pod-tiktok/pod-tiktok.module';
import { PodListingSessionController } from './pod-listing-session.controller';
import { PodListingSessionService } from './services/pod-listing-session.service';
import { PodSessionImportService } from './services/pod-session-import.service';
import { PodSessionProductService } from './services/pod-session-product.service';

/**
 * PodListingSessionModule — **một lượt đăng hàng**: cấu hình → import → review → lên sàn.
 *
 * ```
 *   New Listing (Market · Shops · 5 Template)
 *        ↓ Import Excel/CSV
 *   Draft Product (dữ liệu CON của session)
 *        ↓ Review · Edit · Preview · Validate
 *        ↓ Start Listing
 *   Listing Job (hàng đợi có sẵn) → Draft trên sàn   [Publish: sprint sau]
 * ```
 *
 * 🔴 Module này KHÔNG gọi SDK. Nó dừng lại ở chỗ tạo Listing Job; toàn bộ phần chạm sàn
 * (hàng đợi, retry, upload ảnh, Create Product `AS_DRAFT`) thuộc `PodListingModule`. Một
 * đường duy nhất ra ngoài, không có bản sao thứ hai.
 *
 * Phụ thuộc một chiều: `PodListingSessionModule → PodListingModule`. Chiều ngược lại không
 * tồn tại — Bulk Listing Engine không biết Listing Session là gì, nó chỉ thấy
 * `session_product_id` trên job item và một hàm ghép template dùng chung.
 */
@Module({
  // PodTiktokModule: lấy PodAccessScopeService — phân quyền theo shop được Admin gán.
  imports: [AuthModule, PodListingModule, PodTiktokModule],
  controllers: [PodListingSessionController],
  providers: [PodListingSessionService, PodSessionProductService, PodSessionImportService],
  exports: [PodListingSessionService],
})
export class PodListingSessionModule {}
