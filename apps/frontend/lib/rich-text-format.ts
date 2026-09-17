/**
 * Thao tác định dạng chạy TRỰC TIẾP trên DOM Range — không qua `document.execCommand`.
 *
 * 🔴 **Vì sao tách khỏi `execCommand`.** Cỡ chữ trước đây làm thế này:
 *
 * ```
 *   execCommand('styleWithCSS', true)      // bảo trình duyệt sinh style inline
 *   execCommand('fontSize', '7')           // …rồi mong nó sinh <font size="7">
 *   querySelectorAll('font[size="7"]')     // và đi tìm đúng thẻ vừa bảo nó ĐỪNG sinh
 *   node.replaceWith(span)                 // thay node ⇒ vùng chọn bị huỷ
 * ```
 *
 * Hai lỗi nằm ngay trong bốn dòng đó:
 *
 *  1. Hai dòng đầu **mâu thuẫn nhau**: `styleWithCSS = true` chính là lệnh "đừng dùng thẻ
 *     trình bày kiểu `<font>`". Trình duyệt tôn trọng cờ đó thì sinh
 *     `<span style="font-size: xxx-large">`, và vòng lặp tìm `font[size="7"]` không thấy gì
 *     để chuyển thành px. Lần đầu chữ vẫn to lên (xxx-large) nên trông như đã chạy; những
 *     lần sau đặt lại đúng `xxx-large` ⇒ **không có gì thay đổi**.
 *  2. `replaceWith` **huỷ vùng chọn**. Ngay sau đó code gọi `saveSelection()` và lưu lại một
 *     range đã rỗng; lần đổi cỡ kế tiếp khôi phục đúng range rỗng ấy rồi ra lệnh trên một
 *     vùng không có ký tự nào. Đây là lý do trực tiếp của "chỉ đổi được một lần".
 *
 * Ở đây không có lệnh nào của trình duyệt: ta tự cắt text node theo biên vùng chọn, tự bọc
 * `<span style="font-size: Npx">`, rồi **trả về một Range mới phủ đúng phần vừa sửa** để lần
 * thao tác sau còn có cái mà làm việc. Kết quả không phụ thuộc quirk của trình duyệt — và
 * kiểm được bằng test, thứ mà `execCommand` không cho phép (jsdom không cài đặt nó).
 */

/** Cắt hai đầu vùng chọn rồi trả về các text node NẰM TRỌN trong đó, theo đúng thứ tự. */
export function collectTextNodes(root: Node, range: Range): Text[] {
  if (range.collapsed) return [];

  /**
   * 🔴 Cắt đầu CUỐI trước.
   *
   * Khi hai biên nằm trên cùng một text node, cắt đầu đầu trước sẽ làm `endOffset` trỏ sai
   * chỗ (node đã ngắn đi) — và vùng chọn lan sang phần văn bản người dùng không hề bôi đen.
   */
  let start = range.startContainer;
  let startOffset = range.startOffset;
  const end = range.endContainer;
  const endOffset = range.endOffset;

  if (isText(end) && endOffset > 0 && endOffset < end.data.length) {
    end.splitText(endOffset);
  }
  if (isText(start) && startOffset > 0 && startOffset < start.data.length) {
    start = start.splitText(startOffset);
    startOffset = 0;
  }

  // Sau khi cắt, vùng chọn đã trùng biên node ⇒ dựng lại range để `intersectsNode` đúng.
  const aligned = range.cloneRange();
  if (isText(start) && startOffset === 0) aligned.setStart(start, 0);

  const walker = (root.ownerDocument ?? document).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const result: Text[] = [];

  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (text.data !== '' && aligned.intersectsNode(text) && isInsideRange(text, aligned)) {
      result.push(text);
    }
    node = walker.nextNode();
  }
  return result;
}

/**
 * Đặt cỡ chữ cho vùng chọn. Trả về Range phủ phần vừa sửa (để gọi tiếp được ngay), hoặc
 * `null` nếu không có ký tự nào được chọn.
 *
 * 🔴 Chỉ đụng tới **text node được chọn**. Thẻ `<b>`, `<i>`, `<a>`, `<li>` bao quanh không bị
 * gỡ hay tạo lại — đó là cách giữ nguyên đậm/nghiêng/link/danh sách khi đổi cỡ chữ.
 */
export function applyFontSizeToRange(root: Node, range: Range, px: string): Range | null {
  const texts = collectTextNodes(root, range);
  if (texts.length === 0) return null;

  const wrapped = texts.map((text) => setFontSize(text, px));

  const next = (root.ownerDocument ?? document).createRange();
  next.setStartBefore(wrapped[0]);
  next.setEndAfter(wrapped[wrapped.length - 1]);
  return next;
}

/**
 * Bọc (hoặc sửa tại chỗ) một text node bằng cỡ chữ mới.
 *
 * 🔴 **Sửa tại chỗ khi có thể.** Nếu text node đã nằm trong đúng một `<span>` chỉ có mỗi nó và
 * span ấy đang mang `font-size`, ta ghi đè cỡ của chính span đó. Không có nhánh này thì mỗi
 * lần đổi cỡ lại lồng thêm một span: 12 → 14 → 16 → 20 sinh ra bốn lớp span lồng nhau, HTML
 * phình ra và mọi thao tác sau đều chậm dần.
 */
function setFontSize(text: Text, px: string): HTMLElement {
  const doc = text.ownerDocument ?? document;
  const parent = text.parentElement;

  if (
    parent &&
    parent.tagName === 'SPAN' &&
    parent.childNodes.length === 1 &&
    parent.style.fontSize !== ''
  ) {
    parent.style.fontSize = `${px}px`;
    return parent;
  }

  const span = doc.createElement('span');
  span.style.fontSize = `${px}px`;
  text.parentNode?.insertBefore(span, text);
  span.appendChild(text);
  // Cỡ chữ là thuộc tính KẾ THỪA: span mới nằm trong cùng nên nó thắng. Không cần (và không
  // được) đụng tới span cha — span cha còn phủ cả phần văn bản người dùng không chọn.
  stripFontSize(span);
  return span;
}

/** Gỡ `font-size` của mọi phần tử BÊN TRONG — cỡ cũ nằm sâu hơn sẽ đè mất cỡ vừa đặt. */
function stripFontSize(element: HTMLElement): void {
  for (const child of Array.from(element.querySelectorAll<HTMLElement>('[style]'))) {
    if (child.style.fontSize !== '') {
      child.style.removeProperty('font-size');
      if (child.getAttribute('style') === '') child.removeAttribute('style');
    }
  }
}

/**
 * Chèn một phần tử (ảnh) tại vùng chọn. Trả về Range đặt ngay SAU phần tử vừa chèn, để người
 * dùng gõ tiếp là chữ nằm dưới ảnh chứ không nằm đè lên nó.
 */
export function insertNodeAtRange(range: Range, node: Node): Range {
  range.deleteContents();
  range.insertNode(node);

  const after = (node.ownerDocument ?? document).createRange();
  after.setStartAfter(node);
  after.collapse(true);
  return after;
}

/** Cỡ chữ đang áp cho vùng chọn, `null` nếu không xác định được (nhiều cỡ, hoặc chưa đặt). */
export function currentFontSize(root: Node, range: Range): string | null {
  const texts = collectTextNodes(root, range.cloneRange());
  if (texts.length === 0) return null;

  const sizes = new Set(
    texts.map((text) => {
      let element = text.parentElement;
      while (element && root.contains(element)) {
        if (element.style?.fontSize) return element.style.fontSize.replace('px', '');
        element = element.parentElement;
      }
      return '';
    }),
  );
  return sizes.size === 1 ? ([...sizes][0] || null) : null;
}

function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

/** Text node có nằm TRỌN trong vùng chọn không — `intersectsNode` chỉ nói "có chạm". */
function isInsideRange(text: Text, range: Range): boolean {
  const node = range.cloneRange();
  node.selectNodeContents(text);
  return (
    range.compareBoundaryPoints(Range.START_TO_START, node) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, node) >= 0
  );
}
