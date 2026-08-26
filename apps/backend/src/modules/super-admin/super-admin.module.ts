import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperAdminController } from './super-admin.controller';
import { OrganizationReviewService } from './services/organization-review.service';

/**
 * SuperAdminModule — quản trị NỀN TẢNG: duyệt / từ chối Organization đăng ký mới (§5).
 *
 * 🔴 Đây là module DUY NHẤT đọc dữ liệu xuyên tenant, và nó chỉ chạm đúng một bảng có quyền
 * làm vậy: `organizations` — sổ đăng ký tenant, vốn không mang `organization_id`. Nó KHÔNG
 * đọc đơn hàng, sản phẩm hay bất kỳ dữ liệu nghiệp vụ nào của tổ chức khác, nên ranh giới
 * cô lập dữ liệu của ADR-003/004 vẫn nguyên vẹn.
 *
 * Phụ thuộc một chiều: `SuperAdminModule → AuthModule` (guards). `MailModule` là @Global.
 * Auth KHÔNG biết gì về module này.
 */
@Module({
  imports: [AuthModule],
  controllers: [SuperAdminController],
  providers: [OrganizationReviewService],
})
export class SuperAdminModule {}
