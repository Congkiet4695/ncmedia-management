/**
 * Cỡ chữ & chèn ảnh trong trình soạn thảo — chạy trên DOM thật (jsdom).
 *
 * 🔴 Vì sao bộ test này tồn tại: lỗi "đổi cỡ chữ chỉ được một lần" tồn tại được lâu chính vì
 * phần đó viết bằng `document.execCommand` — mà `execCommand` không có trong jsdom, nên
 * KHÔNG viết test được. Phiên bản mới thao tác thẳng trên Range, và đây là bộ test chứng minh
 * nó đổi được nhiều lần liên tiếp, đúng vùng chọn, và không phá định dạng khác.
 *
 * Chạy: `npm run test:rich-text`
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sanitizeHtml, toEditableHtml } from '../lib/sanitize-html.ts';
import {
  applyFontSizeToRange,
  collectTextNodes,
  currentFontSize,
  insertNodeAtRange,
} from '../lib/rich-text-format.ts';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** Dựng một vùng soạn thảo và trả về bộ công cụ thao tác giống hệt editor thật. */
function editor(html: string) {
  const dom = new JSDOM(`<div id="root" contenteditable>${html}</div>`);
  const { document } = dom.window;
  // `rich-text-format` gọi `Range.START_TO_START` và `NodeFilter` ở phạm vi toàn cục.
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.document = document;
  globals.Range = dom.window.Range;
  globals.NodeFilter = dom.window.NodeFilter;
  // `sanitize-html.ts` dùng `DOMParser` — đúng cửa mà trình duyệt đi qua.
  globals.DOMParser = dom.window.DOMParser;

  const root = document.getElementById('root') as HTMLElement;

  /** Bôi đen đoạn văn bản đầu tiên khớp `needle`, giống người dùng kéo chuột. */
  const select = (needle: string): Range => {
    const walker = document.createTreeWalker(root, dom.window.NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      const index = node.data.indexOf(needle);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        return range;
      }
      node = walker.nextNode() as Text | null;
    }
    throw new Error(`không tìm thấy đoạn "${needle}" trong: ${root.innerHTML}`);
  };

  /** Đổi cỡ chữ cho một đoạn — trả về Range mới, đúng như editor làm. */
  const size = (needle: string, px: string): Range | null =>
    applyFontSizeToRange(root, select(needle), px);

  return { dom, document, root, select, size, html: () => root.innerHTML };
}

console.log('Nguyên nhân gốc — cách CŨ làm mất vùng chọn');

test('🔴 replaceWith huỷ vùng chọn ⇒ lần đổi cỡ thứ hai không còn gì để đổi', () => {
  const dom = new JSDOM('<div id="r"><p>Hello World</p></div>');
  const { document } = dom.window;
  const selection = dom.window.getSelection()!;
  const p = document.querySelector('p')!;

  const range = document.createRange();
  range.setStart(p.firstChild!, 6);
  range.setEnd(p.firstChild!, 11);
  selection.removeAllRanges();
  selection.addRange(range);

  // Đúng thao tác của bản cũ: bọc <font size="7"> rồi thay bằng <span>.
  const font = document.createElement('font');
  font.setAttribute('size', '7');
  selection.getRangeAt(0).surroundContents(font);
  const span = document.createElement('span');
  span.style.fontSize = '32px';
  span.innerHTML = font.innerHTML;
  font.replaceWith(span);

  // `saveSelection()` của bản cũ chạy ĐÚNG lúc này và lưu lại một vùng chọn rỗng.
  const after = selection.getRangeAt(0);
  assert.equal(after.collapsed, true, 'vùng chọn phải đã bị huỷ — đây chính là lỗi');
  assert.equal(after.toString(), '');
});

console.log('\nĐổi cỡ chữ NHIỀU LẦN liên tiếp');

test('🔴 12 → 14 → 16 → 20 → 32 → 40 → 14 trên cùng một đoạn, lần nào cũng ăn', () => {
  const ed = editor('<p>Premium Cluster Photo Paper</p>');

  for (const px of ['12', '14', '16', '20', '32', '40', '14']) {
    const next = ed.size('Premium Cluster Photo Paper', px);
    assert.ok(next, `đổi sang ${px}px phải trả về vùng chọn mới`);
    assert.match(
      ed.html(),
      new RegExp(`font-size:\\s*${px}px`),
      `sau khi chọn ${px}, HTML phải mang đúng ${px}px — nhận: ${ed.html()}`,
    );
  }
});

test('🔴 KHÔNG lồng span chồng chất sau nhiều lần đổi', () => {
  const ed = editor('<p>Heading</p>');
  for (const px of ['12', '14', '16', '20', '32', '40']) ed.size('Heading', px);

  const spans = ed.root.querySelectorAll('span');
  assert.equal(spans.length, 1, `phải còn đúng 1 span, đang có ${spans.length}: ${ed.html()}`);
  assert.equal(ed.html(), '<p><span style="font-size: 40px;">Heading</span></p>');
});

test('đổi ngược 40 → 12 cũng ăn', () => {
  const ed = editor('<p>Body</p>');
  ed.size('Body', '40');
  ed.size('Body', '12');
  assert.match(ed.html(), /font-size:\s*12px/);
  assert.doesNotMatch(ed.html(), /40px/);
});

console.log('\nChỉ đổi ĐÚNG phần được bôi đen');

test('🔴 Hello World: chọn World → 32, rồi Hello → 18, hai đoạn độc lập', () => {
  const ed = editor('<p>Hello World</p>');

  ed.size('World', '32');
  ed.size('Hello', '18');

  const html = ed.html();
  assert.match(html, /<span style="font-size: 18px;">Hello<\/span>/);
  assert.match(html, /<span style="font-size: 32px;">World<\/span>/);
});

test('🔴 kịch bản của đề bài: Heading và Body đổi qua lại nhiều lượt', () => {
  const ed = editor('<p>Heading</p><p>Body</p>');

  ed.size('Heading', '32');
  ed.size('Body', '16');
  ed.size('Heading', '24');
  ed.size('Body', '20');
  ed.size('Heading', '40');

  const html = ed.html();
  assert.match(html, /<span style="font-size: 40px;">Heading<\/span>/, `Heading phải là 40px: ${html}`);
  assert.match(html, /<span style="font-size: 20px;">Body<\/span>/, `Body phải là 20px: ${html}`);
});

test('đoạn không được chọn KHÔNG bị đụng tới', () => {
  const ed = editor('<p>Alpha</p><p>Beta</p>');
  ed.size('Alpha', '32');
  assert.match(ed.html(), /<p>Beta<\/p>/, 'đoạn Beta phải nguyên vẹn');
});

test('vùng chọn rỗng ⇒ không làm gì, không sinh span rác', () => {
  const ed = editor('<p>Alpha</p>');
  const range = ed.document.createRange();
  const text = ed.root.querySelector('p')!.firstChild!;
  range.setStart(text, 2);
  range.collapse(true);

  assert.equal(applyFontSizeToRange(ed.root, range, '32'), null);
  assert.equal(ed.html(), '<p>Alpha</p>');
});

test('chọn vắt qua nhiều đoạn ⇒ cả hai đoạn đổi cỡ, cấu trúc đoạn giữ nguyên', () => {
  const ed = editor('<p>Alpha</p><p>Beta</p>');
  const range = ed.document.createRange();
  const [first, second] = Array.from(ed.root.querySelectorAll('p'));
  range.setStart(first.firstChild!, 0);
  range.setEnd(second.firstChild!, 4);

  applyFontSizeToRange(ed.root, range, '18');
  const html = ed.html();
  assert.match(html, /<p><span style="font-size: 18px;">Alpha<\/span><\/p>/);
  assert.match(html, /<p><span style="font-size: 18px;">Beta<\/span><\/p>/);
});

console.log('\nKhông phá định dạng khác');

test('🔴 Bold giữ nguyên sau khi đổi cỡ', () => {
  const ed = editor('<p><b>Bold text</b></p>');
  ed.size('Bold text', '24');

  assert.match(ed.html(), /<b>/, `thẻ <b> phải còn: ${ed.html()}`);
  assert.match(ed.html(), /font-size: 24px/);
});

test('Italic + Underline + Strike giữ nguyên', () => {
  const ed = editor('<p><i><u><s>Fancy</s></u></i></p>');
  ed.size('Fancy', '20');

  const html = ed.html();
  for (const tag of ['<i>', '<u>', '<s>']) assert.match(html, new RegExp(tag));
  assert.match(html, /font-size: 20px/);
});

test('🔴 Link giữ nguyên href sau khi đổi cỡ', () => {
  const ed = editor('<p><a href="https://shop.example/x">Xem thêm</a></p>');
  ed.size('Xem thêm', '18');

  assert.match(ed.html(), /href="https:\/\/shop\.example\/x"/);
  assert.match(ed.html(), /font-size: 18px/);
});

test('🔴 Danh sách giữ nguyên <ul>/<li>, chỉ chữ trong mục đổi cỡ', () => {
  const ed = editor('<ul><li>Một</li><li>Hai</li></ul>');
  ed.size('Hai', '28');

  const html = ed.html();
  assert.match(html, /<ul><li>Một<\/li><li><span style="font-size: 28px;">Hai<\/span><\/li><\/ul>/);
});

test('màu chữ giữ nguyên, cỡ mới vẫn thắng', () => {
  const ed = editor('<p><span style="color: rgb(255, 0, 0);">Đỏ</span></p>');
  ed.size('Đỏ', '32');

  const html = ed.html();
  assert.match(html, /color: rgb\(255, 0, 0\)/);
  assert.match(html, /font-size: 32px/);
});

test('🔴 cỡ cũ nằm SÂU BÊN TRONG bị gỡ — nếu không nó đè mất cỡ vừa đặt', () => {
  const ed = editor('<p>Trước <span style="font-size: 40px;">To</span> sau</p>');
  const range = ed.document.createRange();
  const p = ed.root.querySelector('p')!;
  range.selectNodeContents(p);

  applyFontSizeToRange(ed.root, range, '16');
  const html = ed.html();
  assert.doesNotMatch(html, /40px/, `cỡ 40px cũ phải bị gỡ: ${html}`);
  assert.match(html, /16px/);
});

test('căn lề của đoạn không bị mất', () => {
  const ed = editor('<p style="text-align: center;">Giữa</p>');
  ed.size('Giữa', '24');

  assert.match(ed.html(), /text-align: center/);
  assert.match(ed.html(), /font-size: 24px/);
});

console.log('\nToken {{…}}');

test('🔴 token không bị cắt vụn khi đổi cỡ cả đoạn', () => {
  const ed = editor('<h2>{{PRODUCT.TITLE}}</h2>');
  ed.size('{{PRODUCT.TITLE}}', '32');

  assert.match(ed.html(), /\{\{PRODUCT\.TITLE\}\}/, `token phải nguyên vẹn: ${ed.html()}`);
  assert.match(ed.html(), /font-size: 32px/);
});

test('đổi cỡ phần chữ cạnh token không đụng vào token', () => {
  const ed = editor('<p>Tên: {{PRODUCT.TITLE}}</p>');
  ed.size('Tên:', '18');

  assert.match(ed.html(), /\{\{PRODUCT\.TITLE\}\}/);
});

console.log('\nChèn ảnh');

test('ảnh được chèn ĐÚNG vị trí con trỏ', () => {
  const ed = editor('<p>Product Features</p>');
  const range = ed.document.createRange();
  const text = ed.root.querySelector('p')!.firstChild as Text;
  range.setStart(text, 7);
  range.collapse(true);

  const img = ed.document.createElement('img');
  img.src = 'https://cdn.example/a.jpg';
  img.alt = 'a.jpg';
  insertNodeAtRange(range, img);

  assert.match(ed.html(), /Product<img src="https:\/\/cdn\.example\/a\.jpg" alt="a\.jpg"> Features/);
});

test('con trỏ nằm SAU ảnh vừa chèn — gõ tiếp không đè lên ảnh', () => {
  const ed = editor('<p>abc</p>');
  const range = ed.document.createRange();
  range.setStart(ed.root.querySelector('p')!.firstChild!, 3);
  range.collapse(true);

  const img = ed.document.createElement('img');
  img.src = 'https://cdn.example/a.jpg';
  const after = insertNodeAtRange(range, img);

  assert.equal(after.collapsed, true);
  assert.equal(after.startContainer.childNodes[after.startOffset - 1], img);
});

test('🔴 ảnh và cỡ chữ sống chung: chèn ảnh xong đổi cỡ đoạn dưới', () => {
  const ed = editor('<h2>Heading</h2><p>Body</p>');
  ed.size('Heading', '32');

  const range = ed.document.createRange();
  range.setStartAfter(ed.root.querySelector('h2')!);
  range.collapse(true);
  const img = ed.document.createElement('img');
  img.src = 'https://cdn.example/a.jpg';
  insertNodeAtRange(range, img);

  ed.size('Body', '18');
  ed.size('Heading', '24');

  const html = ed.html();
  assert.match(html, /<img src="https:\/\/cdn\.example\/a\.jpg">/, `ảnh phải còn: ${html}`);
  assert.match(html, /<span style="font-size: 24px;">Heading<\/span>/);
  assert.match(html, /<span style="font-size: 18px;">Body<\/span>/);
});

console.log('\nĐọc cỡ hiện tại');

test('đọc đúng cỡ của vùng chọn', () => {
  const ed = editor('<p><span style="font-size: 28px;">Text</span></p>');
  assert.equal(currentFontSize(ed.root, ed.select('Text')), '28');
});

test('vùng chọn nhiều cỡ khác nhau ⇒ null, không đoán bừa', () => {
  const ed = editor('<p><span style="font-size: 12px;">A</span><span style="font-size: 32px;">B</span></p>');
  const range = ed.document.createRange();
  range.selectNodeContents(ed.root.querySelector('p')!);
  assert.equal(currentFontSize(ed.root, range), null);
});

console.log('\nCắt biên vùng chọn');

test('🔴 chọn giữa một từ ⇒ chỉ phần được chọn đổi cỡ', () => {
  const ed = editor('<p>abcdef</p>');
  const range = ed.document.createRange();
  const text = ed.root.querySelector('p')!.firstChild as Text;
  range.setStart(text, 2);
  range.setEnd(text, 4);

  applyFontSizeToRange(ed.root, range, '20');
  assert.equal(ed.html(), '<p>ab<span style="font-size: 20px;">cd</span>ef</p>');
});

test('collectTextNodes trả về đúng các node nằm trọn trong vùng chọn', () => {
  const ed = editor('<p>Alpha</p><p>Beta</p>');
  const range = ed.document.createRange();
  const [first, second] = Array.from(ed.root.querySelectorAll('p'));
  range.setStart(first.firstChild!, 0);
  range.setEnd(second.firstChild!, 4);

  assert.deepEqual(
    collectTextNodes(ed.root, range).map((node) => node.data),
    ['Alpha', 'Beta'],
  );
});

console.log('\nLưu → mở lại (đi qua đúng bộ lọc của trình soạn thảo)');

test('🔴 cỡ chữ và ảnh SỐNG SÓT qua sanitize rồi nạp lại', () => {
  const ed = editor('<h2>Heading</h2><p>Body</p>');
  ed.size('Heading', '40');
  ed.size('Body', '20');

  const img = ed.document.createElement('img');
  img.src = 'https://cdn.example/a.jpg';
  img.alt = 'a.jpg';
  img.style.maxWidth = '100%';
  const range = ed.document.createRange();
  range.setStartAfter(ed.root.querySelector('h2')!);
  range.collapse(true);
  insertNodeAtRange(range, img);

  // Đúng đường editor đi: `emit()` lọc trước khi gọi `onChange`.
  const saved = sanitizeHtml(ed.html());
  assert.match(saved, /font-size: 40px/, `cỡ 40px phải còn sau khi lọc: ${saved}`);
  assert.match(saved, /font-size: 20px/);
  assert.ok(saved.includes('src="https://cdn.example/a.jpg"'), `ảnh phải còn: ${saved}`);

  // Và đường mở lại: value → toEditableHtml → innerHTML.
  const reloaded = toEditableHtml(saved);
  assert.match(reloaded, /font-size: 40px/);
  assert.match(reloaded, /font-size: 20px/);
  assert.match(reloaded, /<img/);
});

test('🔴 bộ lọc gỡ onerror nhưng GIỮ tấm ảnh', () => {
  const clean = sanitizeHtml('<img src="https://cdn.example/a.jpg" onerror="alert(1)" alt="x">');

  assert.doesNotMatch(clean, /onerror/);
  assert.ok(clean.includes('src="https://cdn.example/a.jpg"'));
});

test('mở lại rồi đổi cỡ tiếp — vẫn ăn', () => {
  const first = editor('<p>Heading</p>');
  first.size('Heading', '32');
  const saved = sanitizeHtml(first.html());

  const second = editor(toEditableHtml(saved));
  second.size('Heading', '24');

  assert.match(second.html(), /font-size: 24px/);
  assert.doesNotMatch(second.html(), /32px/);
});

console.log(`\n✓ ${passed}/${passed} đúng`);
