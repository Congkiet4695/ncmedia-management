/**
 * Làm sạch HTML TRƯỚC khi đặt vào DOM của trang quản trị.
 *
 * 🔴 Vì sao bắt buộc: nội dung Description Template là HTML do NGƯỜI DÙNG nhập (và có thể
 * đến từ file import). Phần còn lại của hệ thống né rủi ro này bằng cách chỉ render nó
 * trong `iframe sandbox` (xem phần Preview của Description Template) — nhưng một trình
 * soạn thảo WYSIWYG thì buộc phải đặt HTML đó vào `contentEditable` NGAY TRONG trang quản
 * trị. Đó là lần đầu tiên HTML của người dùng chạm vào DOM thật, nên nó phải đi qua đây.
 *
 * Gán `innerHTML` không chạy `<script>`, nhưng đó chỉ là một trong nhiều đường: `<img
 * onerror>` chạy NGAY khi ảnh lỗi, `<iframe src="javascript:">`, `<a href="javascript:">`…
 * Vì vậy lọc theo cả ba trục: thẻ cấm, thuộc tính sự kiện, và URL có lược đồ nguy hiểm.
 *
 * 🔴 Đây KHÔNG phải hàng rào bảo mật cuối cùng và không được dùng thay cho kiểm tra ở
 * server. Nó bảo vệ đúng một thứ: phiên làm việc của người đang mở trình soạn thảo.
 */

/**
 * Thẻ bị GỠ cùng toàn bộ nội dung bên trong.
 *
 * Danh sách CẤM (không phải danh sách cho phép) là có chủ ý: TikTok nhận mọi thẻ HTML hợp
 * lệ trong `description` (xem tài liệu Create Product), nên một danh sách cho phép sẽ âm
 * thầm cắt mất định dạng người dùng cố tình đặt. Ở đây chỉ chặn những thẻ vừa nguy hiểm
 * vừa vô nghĩa với một đoạn mô tả sản phẩm.
 */
const FORBIDDEN_TAGS = new Set([
  'SCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'APPLET',
  'FORM',
  'INPUT',
  'BUTTON',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'LINK',
  'META',
  'BASE',
  'STYLE',
  'SVG',
  'MATH',
  'TEMPLATE',
  'NOSCRIPT',
]);

/** Thuộc tính mang URL — phải soi lược đồ trước khi giữ lại. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster']);

/**
 * Lược đồ URL bị chặn. `data:` được cho qua RIÊNG với ảnh (`data:image/…`) vì nó bất hoạt
 * và có mặt trong nội dung dán từ nơi khác; mọi `data:` khác đều bị gỡ.
 */
const DANGEROUS_SCHEME = /^\s*(javascript|vbscript|file)\s*:/i;
const SAFE_DATA_URL = /^\s*data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)[,;]/i;

/** URL này có an toàn để giữ lại trong thuộc tính không. */
function isSafeUrl(value: string): boolean {
  if (DANGEROUS_SCHEME.test(value)) return false;
  if (/^\s*data:/i.test(value)) return SAFE_DATA_URL.test(value);
  return true;
}

/**
 * Trả về HTML đã lọc.
 *
 * Dùng `DOMParser` chứ không dùng regex: HTML lồng nhau và có hàng chục cách viết né được
 * biểu thức chính quy. Parser cho ra đúng cây mà trình duyệt sẽ dựng, nên thứ ta duyệt qua
 * chính là thứ sẽ chạy.
 *
 * Chạy phía server (SSR) không có `DOMParser` ⇒ trả về chuỗi RỖNG thay vì HTML chưa lọc.
 * Trình soạn thảo là component `'use client'` và chỉ nạp nội dung sau khi mount, nên nhánh
 * này không ảnh hưởng hiển thị — nhưng nếu có ai đó gọi nhầm từ server, im lặng trả HTML
 * thô mới là điều nguy hiểm.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return '';

  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Duyệt trên ẢNH CHỤP danh sách node: việc gỡ node sẽ làm hỏng một NodeList sống.
  const elements = Array.from(doc.body.querySelectorAll('*'));

  for (const element of elements) {
    if (FORBIDDEN_TAGS.has(element.tagName.toUpperCase())) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();

      // Mọi handler `on*` — `onerror`, `onload`, `onclick`… Không có ngoại lệ nào hợp lệ
      // trong một đoạn mô tả sản phẩm.
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (URL_ATTRIBUTES.has(name) && !isSafeUrl(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return doc.body.innerHTML;
}

/**
 * Nội dung này đã là HTML hay chỉ là văn bản thuần?
 *
 * 🔴 Cần thiết vì cột `content_html` ngoài đời KHÔNG phải lúc nào cũng chứa HTML: template
 * soạn trước khi có trình soạn thảo là văn bản thuần có xuống dòng bằng `\n`. Đổ thẳng
 * chuỗi đó vào `contentEditable` sẽ nuốt sạch mọi lần xuống dòng — và nếu người dùng bấm
 * Lưu sau đó thì bản gốc mất luôn.
 */
export function looksLikeHtml(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}

/** Thoát ký tự để một đoạn văn bản thuần nằm an toàn trong HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Đưa nội dung về dạng HTML để hiển thị trong trình soạn thảo.
 *
 * Văn bản thuần ⇒ mỗi dòng trống ngắt một đoạn `<p>`, xuống dòng đơn thành `<br>` — giữ
 * đúng bố cục người dùng đã gõ. HTML ⇒ chỉ lọc, không đụng gì thêm.
 */
export function toEditableHtml(content: string): string {
  if (!content.trim()) return '';
  if (looksLikeHtml(content)) return sanitizeHtml(content);

  return content
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
