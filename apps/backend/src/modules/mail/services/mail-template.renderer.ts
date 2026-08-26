import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MAIL_TEMPLATE,
  MAIL_TOKEN_PATTERN,
  type MailTemplateName,
} from '../constants/mail.constants';

/** Giá trị thay vào `{{TOKEN}}` — luôn là chuỗi, không nhận object/HTML dựng sẵn. */
export type MailTemplateVars = Record<string, string>;

/**
 * MailTemplateRenderer — nạp file HTML rồi thay token.
 *
 * 🔴 HTML nằm ở FILE, không nằm trong service (yêu cầu §12). Người sửa nội dung email không
 * cần đọc TypeScript, và một lần đổi câu chữ không phải là một lần sửa mã nguồn.
 *
 * 🔴 Mọi giá trị thay vào đều được **escape HTML**. Tên Organization và lý do từ chối do
 * người dùng nhập; chèn thẳng vào email là mở đường cho HTML injection trong hộp thư người
 * nhận. Đây là lý do renderer tự escape thay vì tin vào phía gọi.
 *
 * Template được nạp MỘT lần lúc khởi động rồi giữ trong bộ nhớ: chúng là file tĩnh, đọc lại
 * đĩa cho mỗi email chỉ thêm I/O mà không đổi kết quả. Nạp sớm cũng có nghĩa file thiếu hoặc
 * sai tên bị phát hiện lúc boot, không phải lúc một người dùng thật đang chờ email.
 */
@Injectable()
export class MailTemplateRenderer implements OnModuleInit {
  private readonly logger = new Logger(MailTemplateRenderer.name);

  /** Khung chung (`_layout.html`) — mọi email đều nằm trong nó. */
  private layout = '';
  private readonly bodies = new Map<MailTemplateName, string>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.layout = await this.readTemplate('_layout');
    for (const name of Object.values(MAIL_TEMPLATE)) {
      this.bodies.set(name, await this.readTemplate(name));
    }
    this.logger.log({
      module: 'mail',
      operation: 'template.load',
      templates: this.bodies.size,
      msg: 'Đã nạp template email',
    });
  }

  /**
   * Dựng HTML hoàn chỉnh của một email.
   *
   * Thứ tự: thay token vào PHẦN THÂN trước, rồi mới đặt thân vào khung. Làm ngược lại thì
   * một giá trị người dùng nhập có chứa chuỗi `{{...}}` sẽ được coi là token và thay tiếp —
   * tức là dữ liệu tự biến thành template.
   */
  render(template: MailTemplateName, vars: MailTemplateVars): string {
    const body = this.bodies.get(template);
    if (!body) throw new Error(`Template email "${template}" chưa được nạp`);

    const content = this.replaceTokens(body, vars);

    return this.replaceTokens(this.layout, {
      APP_NAME: this.config.get<string>('mail.fromName', 'NCMedia'),
      SUBJECT: vars.SUBJECT ?? '',
      // CONTENT là HTML đã dựng xong ⇒ chèn NGUYÊN VĂN, không escape lần hai.
    }).replace('{{CONTENT}}', content);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private replaceTokens(source: string, vars: MailTemplateVars): string {
    return source.replace(MAIL_TOKEN_PATTERN, (match, token: string) => {
      const value = vars[token];
      // Token không có giá trị ⇒ giữ nguyên chỗ trống thay vì in chữ "undefined" cho người
      // nhận đọc. Ghi cảnh báo để lỗi lộ ra ở log chứ không lộ ra ở hộp thư khách hàng.
      if (value === undefined) {
        if (token !== 'CONTENT') {
          this.logger.warn({ module: 'mail', token, msg: 'Template thiếu giá trị cho token' });
        }
        return token === 'CONTENT' ? match : '';
      }
      return this.escapeHtml(value);
    });
  }

  /** Escape 5 ký tự đủ để chặn cả chèn thẻ lẫn thoát khỏi thuộc tính. */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Đọc file template, thử lần lượt các vị trí có thể.
   *
   * 🔴 Bố cục thư mục `dist` KHÔNG cố định: `nest build` cho ra `dist/modules/mail/…`, nhưng
   * chỉ cần một file `.ts` nằm ngoài `src/` là `tsc` nới rootDir và mọi thứ tụt xuống
   * `dist/src/modules/mail/…`. Khi đó `assets` của nest-cli vẫn chép vào `dist/modules/…` và
   * hai đường dẫn lệch nhau — ứng dụng chết ngay lúc khởi động vì không đọc được một file HTML.
   *
   * Thử vài vị trí ứng viên rồi mới bỏ cuộc: `MailService` đã chấp nhận chạy ở chế độ chỉ-ghi-log
   * khi thiếu SMTP, nên để riêng phần đọc template làm sập cả tiến trình là không nhất quán.
   */
  private async readTemplate(name: string): Promise<string> {
    const candidates = [
      // Cạnh mã đã biên dịch (bố cục thường gặp của cả dev lẫn production).
      join(__dirname, '..', 'templates', `${name}.html`),
      // `dist/src/...` nhưng assets nằm ở `dist/...`.
      join(__dirname, '..', '..', '..', '..', 'modules', 'mail', 'templates', `${name}.html`),
      // Nguồn gốc — luôn có mặt khi chạy từ thư mục dự án.
      join(process.cwd(), 'src', 'modules', 'mail', 'templates', `${name}.html`),
    ];

    for (const path of candidates) {
      try {
        return await readFile(path, 'utf8');
      } catch {
        continue;
      }
    }

    throw new Error(
      `Không đọc được template email "${name}". Đã thử: ${candidates.join(' | ')}`,
    );
  }
}
