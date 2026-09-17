import { sanitizeDescriptionHtml } from './description-html.sanitizer';

/**
 * **Lọc HTML mô tả ở phía server.**
 *
 * 🔴 Bộ test này canh hai phía của cùng một lằn ranh, và sai phía nào cũng đắt:
 *   - Lọt một `onerror` ⇒ XSS chạy trong trang quản trị của người vận hành.
 *   - Lọc quá tay ⇒ người dùng chèn ảnh, đổi cỡ chữ, bấm Lưu, mở lại và thấy công sức biến
 *     mất. Không có thông báo nào, và họ sẽ nghĩ chức năng bị hỏng.
 */

describe('sanitizeDescriptionHtml — giữ nguyên thứ hợp lệ', () => {
  it('🔴 GIỮ cỡ chữ inline — đây đúng là thứ vừa sửa xong', () => {
    const html = '<span style="font-size: 32px;">Key Features</span>';
    expect(sanitizeDescriptionHtml(html)).toContain('font-size:32px');
  });

  it('giữ font-family, màu chữ, màu nền, căn lề', () => {
    const out = sanitizeDescriptionHtml(
      '<p style="text-align: center; color: #ff0000; background-color: #eee; font-family: Arial, sans-serif;">x</p>',
    );

    expect(out).toContain('text-align:center');
    expect(out).toContain('color:#ff0000');
    expect(out).toContain('font-family:Arial');
  });

  it('giữ đậm / nghiêng / gạch chân / gạch ngang', () => {
    const out = sanitizeDescriptionHtml('<b>a</b><strong>b</strong><i>c</i><u>d</u><s>e</s>');
    for (const tag of ['<b>', '<strong>', '<i>', '<u>', '<s>']) expect(out).toContain(tag);
  });

  it('giữ danh sách và trích dẫn', () => {
    const out = sanitizeDescriptionHtml('<ul><li>a</li></ul><ol><li>b</li></ol><blockquote>c</blockquote>');
    expect(out).toContain('<ul><li>a</li></ul>');
    expect(out).toContain('<ol><li>b</li></ol>');
    expect(out).toContain('<blockquote>c</blockquote>');
  });

  it('giữ link http/https/mailto', () => {
    expect(sanitizeDescriptionHtml('<a href="https://shop.example/x">x</a>')).toContain(
      'href="https://shop.example/x"',
    );
    expect(sanitizeDescriptionHtml('<a href="mailto:a@b.com">m</a>')).toContain('mailto:a@b.com');
  });

  it('🔴 GIỮ ảnh cùng src / alt / kích thước / style', () => {
    const html =
      '<img src="https://cdn.example/a.jpg" alt="Mockup" width="600" height="400" style="max-width: 100%;">';
    const out = sanitizeDescriptionHtml(html);

    expect(out).toContain('src="https://cdn.example/a.jpg"');
    expect(out).toContain('alt="Mockup"');
    expect(out).toContain('width="600"');
    expect(out).toContain('max-width:100%');
  });

  it('giữ ảnh data:image dán từ nơi khác', () => {
    const out = sanitizeDescriptionHtml('<img src="data:image/png;base64,iVBORw0KGgo=">');
    expect(out).toContain('data:image/png;base64');
  });

  it('giữ bảng', () => {
    const out = sanitizeDescriptionHtml('<table><tr><td colspan="2">a</td></tr></table>');
    expect(out).toContain('<td colspan="2">a</td>');
  });

  it('🔴 token đi qua NGUYÊN VẸN — chúng là văn bản, không phải thẻ', () => {
    const html = '<h2 style="font-size:32px;">{{PRODUCT.TITLE}}</h2><p>{{SHOP.NAME}}</p>';
    const out = sanitizeDescriptionHtml(html);

    expect(out).toContain('{{PRODUCT.TITLE}}');
    expect(out).toContain('{{SHOP.NAME}}');
    expect(out).toContain('font-size:32px');
  });

  it('chuỗi rỗng ⇒ chuỗi rỗng, không ném lỗi', () => {
    expect(sanitizeDescriptionHtml('')).toBe('');
  });

  it('văn bản thuần giữ nguyên', () => {
    expect(sanitizeDescriptionHtml('Mô tả không có thẻ nào')).toBe('Mô tả không có thẻ nào');
  });
});

describe('sanitizeDescriptionHtml — chặn thứ nguy hiểm', () => {
  it('🔴 gỡ <script> cùng nội dung bên trong', () => {
    const out = sanitizeDescriptionHtml('<p>a</p><script>alert(1)</script>');

    expect(out).not.toContain('script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('<p>a</p>');
  });

  it('🔴 gỡ onerror trên ảnh — nhưng GIỮ lại chính tấm ảnh đó', () => {
    const out = sanitizeDescriptionHtml(
      '<img src="https://cdn.example/a.jpg" onerror="alert(1)" alt="x">',
    );

    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert');
    expect(out).toContain('src="https://cdn.example/a.jpg"');
  });

  it('gỡ mọi handler on*', () => {
    const out = sanitizeDescriptionHtml(
      '<p onclick="x()" onload="y()" onmouseover="z()">text</p>',
    );

    expect(out).toBe('<p>text</p>');
  });

  it('🔴 gỡ href="javascript:"', () => {
    const out = sanitizeDescriptionHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
  });

  it('gỡ src="javascript:" trên ảnh', () => {
    expect(sanitizeDescriptionHtml('<img src="javascript:alert(1)">')).not.toContain('javascript:');
  });

  it('chặn cả biến thể viết hoa và có khoảng trắng của javascript:', () => {
    for (const payload of ['JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)']) {
      expect(sanitizeDescriptionHtml(`<a href="${payload}">x</a>`)).not.toMatch(/javascript\s*:/i);
    }
  });

  it('🔴 gỡ <iframe>', () => {
    const out = sanitizeDescriptionHtml('<iframe src="https://evil.example"></iframe><p>a</p>');

    expect(out).not.toContain('iframe');
    expect(out).toContain('<p>a</p>');
  });

  it('gỡ object / embed / form / input', () => {
    const out = sanitizeDescriptionHtml(
      '<object data="x"></object><embed src="x"><form action="/x"><input name="a"></form>',
    );
    for (const tag of ['object', 'embed', 'form', 'input']) expect(out).not.toContain(`<${tag}`);
  });

  it('gỡ <style> cùng nội dung — CSS toàn cục không thuộc về một đoạn mô tả', () => {
    const out = sanitizeDescriptionHtml('<style>body{display:none}</style><p>a</p>');

    expect(out).not.toContain('display:none');
    expect(out).toContain('<p>a</p>');
  });

  it('🔴 gỡ svg (vector chứa được script) nhưng giữ phần còn lại', () => {
    const out = sanitizeDescriptionHtml('<svg><script>alert(1)</script></svg><p>giữ lại</p>');

    expect(out).not.toContain('svg');
    expect(out).not.toContain('alert');
    expect(out).toContain('giữ lại');
  });

  it('gỡ data: không phải ảnh', () => {
    const out = sanitizeDescriptionHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out).not.toContain('data:text/html');
  });

  it('🔴 lọc hai lần cho kết quả GIỐNG HỆT — nội dung đã lưu không bị bào mòn dần', () => {
    const html =
      '<h2 style="font-size: 32px;">{{PRODUCT.TITLE}}</h2>' +
      '<p><b>Đậm</b> <a href="https://x.example">link</a></p>' +
      '<img src="https://cdn.example/a.jpg" alt="a" style="max-width: 100%;">';

    const once = sanitizeDescriptionHtml(html);
    expect(sanitizeDescriptionHtml(once)).toBe(once);
  });
});
