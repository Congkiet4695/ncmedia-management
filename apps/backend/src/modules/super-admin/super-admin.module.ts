import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DistributedLockService } from '../pod-tiktok/infra/distributed-lock.service';
import { SuperAdminController } from './super-admin.controller';
import { OrganizationDeletionService } from './services/organization-deletion.service';
import { OrganizationReviewService } from './services/organization-review.service';

/**
 * SuperAdminModule — quản trị NỀN TẢNG: duyệt / từ chối Organization đăng ký mới (§5) và XOÁ CỨNG
 * một Organization.
 *
 * 🔴 Đây là module DUY NHẤT thao tác xuyên tenant. Duyệt / từ chối chỉ chạm `organizations` — sổ đăng
 * ký tenant, vốn không mang `organization_id`. Xoá Organization là ngoại lệ DUY NHẤT chạm dữ liệu
 * nghiệp vụ, và nó vẫn đi theo `organization_id` của đúng một tổ chức (mọi lệnh DELETE đều lọc theo
 * cột đó, có kiểm tham chiếu xuyên tenant trước khi xoá) — xem `OrganizationDeletionService`. Module
 * KHÔNG đọc đơn hàng, sản phẩm hay dữ liệu nghiệp vụ của tổ chức khác.
 *
 * Phụ thuộc một chiều: `SuperAdminModule → AuthModule` (guards, cache phiên). `MailModule` là @Global.
 * Auth KHÔNG biết gì về module này.
 */
@Module({
  imports: [AuthModule],
  controllers: [SuperAdminController],
  // DistributedLockService: lớp mỏng trên RedisService (@Global), không trạng thái — khai trực tiếp thay
  // vì import cả PodTiktokModule chỉ để lấy một khoá.
  providers: [OrganizationReviewService, OrganizationDeletionService, DistributedLockService],
})
export class SuperAdminModule {}
