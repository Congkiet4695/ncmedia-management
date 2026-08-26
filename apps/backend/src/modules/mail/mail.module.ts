import { Global, Module } from '@nestjs/common';
import { MailTemplateRenderer } from './services/mail-template.renderer';
import { MailService } from './services/mail.service';

/**
 * MailModule — hạ tầng gửi email dùng chung (yêu cầu §11).
 *
 * 🔴 `@Global` vì email là **hạ tầng ngang**, giống Prisma: Auth, Super Admin và mọi module
 * sau này đều có thể cần gửi thư, và bắt từng module khai báo lại `imports: [MailModule]` chỉ
 * tạo ra một danh sách phải nhớ cập nhật.
 *
 * Chỉ export `MailService`. `MailTemplateRenderer` là chi tiết bên trong — phía ngoài không
 * được tự dựng HTML rồi nhờ module này gửi hộ, vì đó chính là thứ §12 cấm.
 */
@Global()
@Module({
  providers: [MailTemplateRenderer, MailService],
  exports: [MailService],
})
export class MailModule {}
