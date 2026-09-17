import sanitize from 'sanitize-html';

/**
 * Làm sạch HTML mô tả sản phẩm **ở phía server**.
 *
 * 🔴 Vì sao cần dù trình soạn thảo đã lọc: bộ lọc ở trình duyệt chỉ bảo vệ phiên của chính
 * người đang gõ. `PATCH /pod/templates/descriptions/:id` là một endpoint HTTP bình thường —
 * ai có token đều gửi thẳng `contentHtml` tuỳ ý được, không cần đi qua trình soạn thảo. Đoạn
 * HTML đó sau này được đổ vào `srcDoc` của khung xem trước, vào bản nháp listing, và gửi sang
 * TikTok. Đây là chỗ cuối cùng còn kiểm soát được.
 *
 * 🔴 **Không được lọc mất ảnh hợp lệ.** Ảnh là thứ vừa bổ sung cho mô tả; một bộ lọc chặt tay
 * gỡ luôn `<img>` sẽ khiến người dùng chèn ảnh, lưu, mở lại và thấy ảnh biến mất — im lặng,
 * không thông báo. Vì vậy `img` nằm trong danh sách cho phép cùng `src`/`alt`/`width`/
 * `height`/`style`.
 *
 * Danh sách CHO PHÉP (không phải danh sách cấm): thẻ lạ mà ta chưa lường trước thì gỡ đi an
 * toàn hơn là giữ lại. Danh sách dưới đây đã phủ mọi thứ trình soạn thảo sinh ra và mọi thứ
 * một đoạn mô tả sản phẩm cần.
 */

/** Thẻ được giữ lại. Bao trọn đầu ra của `RichTextEditor` cộng thẻ bảng cho mô tả gõ tay. */
const ALLOWED_TAGS = [
  'p', 'div', 'span', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'small', 'mark',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'font', 'center',
];

/**
 * Thuộc tính CSS được giữ trong `style`.
 *
 * 🔴 `font-size`, `font-family`, `color`, `text-align` nằm trong đây là BẮT BUỘC: mô tả hiển
 * thị trên trang TikTok, nơi không có file CSS nào của ta, nên định dạng chỉ sống được dưới
 * dạng style inline. Lọc mất chúng là lọc mất đúng thứ người dùng vừa chỉnh.
 */
const ALLOWED_STYLES = [
  'color', 'background-color',
  'font-size', 'font-family', 'font-weight', 'font-style',
  'text-align', 'text-decoration', 'line-height', 'letter-spacing',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'width', 'height', 'max-width', 'min-width', 'display', 'float', 'border',
  'border-collapse', 'vertical-align',
];

/**
 * 🔴 `star` = áp cho MỌI thẻ. `sanitize-html` nhận biểu thức chính quy cho từng thuộc tính
 * CSS; `.*` ở đây nghĩa là không ràng buộc giá trị, vì cấm được cái nguy hiểm thì đã cấm từ
 * vòng thuộc tính rồi (`expression()` và `url(javascript:…)` đều bị thư viện gỡ).
 */
const STYLE_RULES = Object.fromEntries(ALLOWED_STYLES.map((name) => [name, [/.*/]]));

const OPTIONS: sanitize.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    // `style` và `class` cho mọi thẻ — đó là nơi định dạng của trình soạn thảo nằm.
    '*': ['style', 'class', 'align', 'dir', 'lang', 'title'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    font: ['color', 'face', 'size'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
    col: ['span'],
  },
  allowedStyles: { '*': STYLE_RULES },
  /**
   * 🔴 Lược đồ URL. `javascript:`, `vbscript:`, `file:` không có mặt ⇒ bị gỡ. `data:` được
   * giữ RIÊNG cho `img` vì nội dung dán từ nơi khác hay mang theo ảnh nội tuyến; thư viện
   * vẫn kiểm `data:` phải là ảnh.
   */
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: true,
  // Thẻ bị gỡ nhưng GIỮ phần chữ bên trong — trừ script/style, nơi "chữ bên trong" chính là mã.
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed'],
  // Không tự thêm `rel="noopener"`… — đầu ra còn phải gửi sang TikTok, càng ít biến đổi càng tốt.
  transformTags: {},
};

/**
 * Trả về HTML đã lọc. Chuỗi rỗng vào ⇒ chuỗi rỗng ra.
 *
 * 🔴 Token `{{PRODUCT.TITLE}}` đi qua nguyên vẹn: chúng là **văn bản**, không phải thẻ, nên
 * bộ lọc không đụng tới. Có test canh đúng điều này — thay token là bước sau, và một bộ lọc
 * nuốt mất dấu ngoặc nhọn sẽ làm hỏng toàn bộ template mà không báo gì.
 */
export function sanitizeDescriptionHtml(html: string): string {
  if (!html) return '';
  return sanitize(html, OPTIONS);
}
