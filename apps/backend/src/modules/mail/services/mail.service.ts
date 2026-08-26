import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { maskEmail } from '../../../common/utils/mask-email.util';
import {
  MAIL_SEND_TIMEOUT_MS,
  MAIL_SUBJECT,
  MAIL_TEMPLATE,
  type MailTemplateName,
} from '../constants/mail.constants';
import { MailTemplateRenderer } from './mail-template.renderer';

/** Kết quả một lần gửi — `false` nghĩa là đã ghi log lỗi, KHÔNG ném ra ngoài. */
export interface MailSendResult {
  sent: boolean;
  error?: string;
}

/**
 * MailService — **cửa duy nhất** gửi email của hệ thống.
 *
 * 🔴 Không service nghiệp vụ nào tự dựng SMTP hay tự viết HTML (yêu cầu §11, §12): Auth và
 * Super Admin chỉ gọi ba hàm `sendOrganization*` bên dưới và không biết gì về nodemailer,
 * cổng SMTP hay tên file template.
 *
 * 🔴 **Gửi email KHÔNG BAO GIỜ làm hỏng nghiệp vụ.** Một lỗi SMTP không được phép làm đăng ký
 * thất bại sau khi Organization đã được tạo, cũng không được phép làm một lệnh Approve đã
 * commit trở thành lỗi 500 trước mặt Super Admin. Vì vậy mọi hàm gửi đều trả về kết quả thay
 * vì ném lỗi — thất bại nằm ở log và ở cờ `emailSent` của response.
 *
 * Cấu hình đọc từ ENV (`MAIL_*`), không hardcode. Gmail yêu cầu **App Password**, không phải
 * mật khẩu tài khoản.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);

  private transporter?: Transporter;
  /** Thiếu cấu hình SMTP ⇒ module chạy ở chế độ "chỉ ghi log", hệ thống vẫn hoạt động. */
  private enabled = false;

  constructor(
    private readonly config: ConfigService,
    private readonly renderer: MailTemplateRenderer,
  ) {}

  onModuleInit(): void {
    const user = this.config.get<string>('mail.user');
    const pass = this.config.get<string>('mail.pass');

    // Dev/CI thường không có SMTP thật. Bắt buộc phải có mới boot được thì không ai chạy được
    // hệ thống ở máy mình — nên thiếu cấu hình là CẢNH BÁO, không phải lỗi chết.
    if (!user || !pass) {
      this.logger.warn({
        module: 'mail',
        msg: 'MAIL_USER/MAIL_PASS chưa cấu hình — email sẽ KHÔNG được gửi, chỉ ghi log',
      });
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: this.config.getOrThrow<string>('mail.host'),
      port: this.config.getOrThrow<number>('mail.port'),
      // Gmail cổng 587 dùng STARTTLS ⇒ `secure = false`; cổng 465 mới là `secure = true`.
      secure: this.config.get<boolean>('mail.secure', false),
      auth: { user, pass },
      connectionTimeout: MAIL_SEND_TIMEOUT_MS,
      greetingTimeout: MAIL_SEND_TIMEOUT_MS,
      socketTimeout: MAIL_SEND_TIMEOUT_MS,
    });
    this.enabled = true;

    this.logger.log({
      module: 'mail',
      driver: this.config.get<string>('mail.driver'),
      host: this.config.get<string>('mail.host'),
      port: this.config.get<number>('mail.port'),
      msg: 'Đã khởi tạo SMTP transporter',
    });
  }

  // ---------------------------------------------------------------------------
  // API nghiệp vụ — ba email của luồng duyệt đăng ký
  // ---------------------------------------------------------------------------

  /** §3 — vừa đăng ký xong. KHÔNG kèm mật khẩu, KHÔNG kèm link đăng nhập. */
  sendOrganizationRegistered(input: {
    to: string;
    fullName: string;
    organizationName: string;
  }): Promise<MailSendResult> {
    return this.send(MAIL_TEMPLATE.ORGANIZATION_REGISTERED, input.to, {
      FULL_NAME: input.fullName,
      ORGANIZATION_NAME: input.organizationName,
      EMAIL: input.to,
    });
  }

  /** §8 — Super Admin đã duyệt. Đây là email DUY NHẤT mang link đăng nhập. */
  sendOrganizationApproved(input: {
    to: string;
    fullName: string;
    organizationName: string;
  }): Promise<MailSendResult> {
    return this.send(MAIL_TEMPLATE.ORGANIZATION_APPROVED, input.to, {
      FULL_NAME: input.fullName,
      ORGANIZATION_NAME: input.organizationName,
      LOGIN_URL: this.loginUrl(),
    });
  }

  /** §9 — Super Admin từ chối. `reason` là bắt buộc ở tầng DTO. */
  sendOrganizationRejected(input: {
    to: string;
    fullName: string;
    organizationName: string;
    reason: string;
  }): Promise<MailSendResult> {
    return this.send(MAIL_TEMPLATE.ORGANIZATION_REJECTED, input.to, {
      FULL_NAME: input.fullName,
      ORGANIZATION_NAME: input.organizationName,
      REASON: input.reason,
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async send(
    template: MailTemplateName,
    to: string,
    vars: Record<string, string>,
  ): Promise<MailSendResult> {
    const subject = MAIL_SUBJECT[template];
    const html = this.renderer.render(template, { ...vars, SUBJECT: subject });

    if (!this.enabled || !this.transporter) {
      this.logger.warn({
        module: 'mail',
        operation: 'send.skipped',
        template,
        to: maskEmail(to),
        subject,
        msg: 'SMTP chưa cấu hình — bỏ qua việc gửi',
      });
      return { sent: false, error: 'SMTP chưa được cấu hình' };
    }

    try {
      await this.transporter.sendMail({
        from: {
          name: this.config.get<string>('mail.fromName', 'NCMedia'),
          address: this.config.getOrThrow<string>('mail.from'),
        },
        to,
        subject,
        html,
      });

      // 🔴 Log địa chỉ đã CHE — nhật ký ứng dụng không phải nơi lưu danh sách email khách hàng.
      this.logger.log({
        module: 'mail',
        operation: 'send',
        template,
        to: maskEmail(to),
        msg: 'Đã gửi email',
      });
      return { sent: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lỗi SMTP không xác định';
      this.logger.error({
        module: 'mail',
        operation: 'send.fail',
        template,
        to: maskEmail(to),
        msg: message,
      });
      return { sent: false, error: message };
    }
  }

  /** Link đăng nhập dựng từ URL công khai của hệ thống (ENV), không hardcode domain. */
  private loginUrl(): string {
    const base = this.config.get<string>('app.publicUrl', '').replace(/\/+$/, '');
    return `${base}/login`;
  }
}
