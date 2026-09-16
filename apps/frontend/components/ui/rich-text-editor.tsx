'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Indent,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Outdent,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { sanitizeHtml, toEditableHtml } from '@/lib/sanitize-html';

/**
 * RichTextEditor — trình soạn thảo WYSIWYG, **không phụ thuộc thư viện ngoài**.
 *
 * 🔴 Vì sao tự dựng thay vì lắp TipTap/Quill (quyết định có chủ đích, không phải tiết kiệm
 * công):
 *
 *  1. **Đầu ra phải là HTML có style INLINE.** Mô tả sản phẩm được gửi thẳng sang TikTok và
 *     hiển thị trên trang sản phẩm của họ — nơi không có file CSS nào của chúng ta. Quill
 *     mặc định sinh class (`ql-align-center`, `ql-indent-1`, `ql-size-large`), nên căn lề và
 *     cỡ chữ sẽ BIẾN MẤT trên TikTok trong khi vẫn đẹp ở trang quản trị: hỏng âm thầm, đúng
 *     kiểu lỗi tốn nhiều ngày nhất để phát hiện. Ở đây `styleWithCSS` bắt trình duyệt sinh
 *     `style="…"` inline cho mọi lệnh.
 *  2. **Quy ước của dự án.** `modal.tsx`, `tooltip.tsx`, `checkbox.tsx` đều tự dựng, không
 *     kéo Radix vào. Frontend hiện KHÔNG có một thư viện UI nào ngoài `lucide-react`.
 *  3. Đổi ý về sau chỉ phải thay ĐÚNG file này — hợp đồng ra ngoài chỉ là `value`/`onChange`
 *     trên một chuỗi HTML.
 *
 * ⚠️ Đánh đổi đã biết: `document.execCommand` là API **deprecated**. Nó vẫn chạy ở mọi trình
 * duyệt hiện hành và chưa có API thay thế nào được chuẩn hoá, nhưng đây là chỗ cần theo dõi.
 * Mọi lời gọi `execCommand` đều nằm trong file này để hôm nào phải thay thì chỉ thay một chỗ.
 *
 * 🔴 `contentEditable` KHÔNG thể là component được React kiểm soát: React ghi đè `innerHTML`
 * ở mỗi lần render sẽ nhảy con trỏ về đầu sau mỗi ký tự. Vì thế DOM tự giữ nội dung, và
 * `value` chỉ được ghi ngược vào DOM khi nó THỰC SỰ khác thứ đang hiển thị (xem `useEffect`).
 */

/** Thao tác gọi được từ bên ngoài (form Description dùng để chèn token tại con trỏ). */
export interface RichTextEditorHandle {
  /** Chèn văn bản thuần tại vị trí con trỏ; con trỏ đứng ngay sau đoạn vừa chèn. */
  insertText: (text: string) => void;
  focus: () => void;
}

interface RichTextEditorProps {
  /** HTML hiện tại. Nhận cả văn bản thuần — xem `toEditableHtml`. */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Chiều cao tối thiểu của vùng soạn thảo. */
  minHeight?: string;
  className?: string;
  /** Nhãn i18n — component UI không tự dịch. */
  labels?: Partial<RichTextEditorLabels>;
}

export interface RichTextEditorLabels {
  paragraph: string;
  heading1: string;
  heading2: string;
  heading3: string;
  font: string;
  fontSize: string;
  bold: string;
  italic: string;
  underline: string;
  strikethrough: string;
  textColor: string;
  backgroundColor: string;
  link: string;
  unlink: string;
  blockquote: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  alignJustify: string;
  bulletList: string;
  numberedList: string;
  outdent: string;
  indent: string;
  undo: string;
  redo: string;
  clearFormatting: string;
  sourceMode: string;
  linkUrl: string;
  linkApply: string;
  linkCancel: string;
}

const DEFAULT_LABELS: RichTextEditorLabels = {
  paragraph: 'Paragraph',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  font: 'Font',
  fontSize: 'Size',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strikethrough: 'Strikethrough',
  textColor: 'Text color',
  backgroundColor: 'Highlight color',
  link: 'Insert link',
  unlink: 'Remove link',
  blockquote: 'Blockquote',
  alignLeft: 'Align left',
  alignCenter: 'Align center',
  alignRight: 'Align right',
  alignJustify: 'Justify',
  bulletList: 'Bullet list',
  numberedList: 'Numbered list',
  outdent: 'Decrease indent',
  indent: 'Increase indent',
  undo: 'Undo',
  redo: 'Redo',
  clearFormatting: 'Clear formatting',
  sourceMode: 'HTML source',
  linkUrl: 'https://…',
  linkApply: 'Apply',
  linkCancel: 'Cancel',
};

/**
 * Bộ font đề xuất.
 *
 * Cố tình chỉ gồm **font an toàn trên mọi máy**: mô tả hiển thị trên máy người mua, nơi
 * không có cách nào nạp webfont. Chọn một font lạ ở đây nghĩa là người mua thấy font mặc
 * định của họ — tức là chọn mà không có tác dụng.
 */
const FONT_OPTIONS = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
];

/** Cỡ chữ tính bằng px — con số người dùng đọc hiểu được, không phải thang 1–7 của HTML cũ. */
const FONT_SIZE_OPTIONS = ['12', '14', '16', '18', '20', '24', '28', '32', '40'];

/**
 * Cỡ chữ "mồi" của `execCommand('fontSize')`.
 *
 * 🔴 `fontSize` chỉ nhận thang 1–7 của HTML đời đầu và sinh ra `<font size="7">` — kể cả khi
 * `styleWithCSS` đang bật. Không có lệnh nào đặt được px trực tiếp. Cách duy nhất còn lại:
 * gọi lệnh với một cỡ KHÔNG BAO GIỜ dùng thật (7), rồi tìm đúng những nút vừa sinh ra đó mà
 * đổi thành `<span style="font-size: Npx">`. Xem `applyFontSize`.
 */
const FONT_SIZE_SENTINEL = '7';

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(
    { value, onChange, placeholder, minHeight = '260px', className, labels },
    ref,
  ) {
    const text = { ...DEFAULT_LABELS, ...labels };
    const editorRef = useRef<HTMLDivElement>(null);
    const savedRange = useRef<Range | null>(null);
    /** Giá trị mà chính editor vừa phát ra — để `useEffect` không ghi đè ngược lên DOM. */
    const emittedValue = useRef<string | null>(null);

    const [sourceMode, setSourceMode] = useState(false);
    const [linkOpen, setLinkOpen] = useState(false);
    const [linkUrl, setLinkUrl] = useState('');

    // Đồng bộ MỘT CHIỀU value → DOM, và chỉ khi DOM chưa phản ánh `value`. Bỏ điều kiện này
    // là con trỏ nhảy về đầu sau mỗi phím gõ.
    //
    // 🔴 Phải soi thêm DOM có RỖNG không, không chỉ so với giá trị đã phát ra: khi người dùng
    // rời chế độ HTML thô, vùng `contentEditable` được mount LẠI và rỗng trơn, trong khi
    // `emittedValue` vẫn nhớ đúng chuỗi đang có ⇒ chỉ so ref thì điều kiện khớp, effect bỏ
    // qua, và người dùng nhận về một khung soạn thảo trắng cùng cảm giác vừa mất hết bài.
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || sourceMode) return;
      if (value === emittedValue.current && editor.innerHTML.trim() !== '') return;
      editor.innerHTML = toEditableHtml(value);
    }, [value, sourceMode]);

    const emit = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      // Lọc ngay ở đường ra: nội dung DÁN VÀO có thể mang theo `onerror`, `<script>`…
      const html = sanitizeHtml(editor.innerHTML);
      emittedValue.current = html;
      onChange(html);
    }, [onChange]);

    /** Ghi nhớ vùng chọn — cần cho các điều khiển KHÔNG giữ được focus (select, input màu). */
    const saveSelection = useCallback(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (editorRef.current?.contains(range.commonAncestorContainer)) {
        savedRange.current = range.cloneRange();
      }
    }, []);

    const restoreSelection = useCallback(() => {
      const range = savedRange.current;
      if (!range) return;
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, []);

    /**
     * Chạy một lệnh soạn thảo.
     *
     * `styleWithCSS` được bật lại ở MỖI lệnh, không phải một lần lúc mount: cờ này thuộc về
     * document và bất kỳ đoạn mã nào khác cũng tắt được nó — mà tắt rồi thì trình duyệt quay
     * lại sinh `<font>` với `<b>`, và style inline mà TikTok cần thì không còn.
     */
    const exec = useCallback(
      (command: string, commandValue?: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        restoreSelection();
        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand(command, false, commandValue);
        saveSelection();
        emit();
      },
      [emit, restoreSelection, saveSelection],
    );

    /** Cỡ chữ theo px — xem ghi chú ở `FONT_SIZE_SENTINEL`. */
    const applyFontSize = useCallback(
      (px: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        restoreSelection();
        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand('fontSize', false, FONT_SIZE_SENTINEL);

        for (const node of Array.from(editor.querySelectorAll(`font[size="${FONT_SIZE_SENTINEL}"]`))) {
          const span = document.createElement('span');
          span.style.fontSize = `${px}px`;
          span.innerHTML = node.innerHTML;
          node.replaceWith(span);
        }

        saveSelection();
        emit();
      },
      [emit, restoreSelection, saveSelection],
    );

    /**
     * Xoá định dạng: bỏ style ký tự, gỡ link, và đưa khối về đoạn văn thường.
     * `removeFormat` một mình KHÔNG đụng tới khối — tiêu đề vẫn là tiêu đề, danh sách vẫn là
     * danh sách, và người dùng bấm "xoá định dạng" mà thấy chữ vẫn to thì nút đó vô nghĩa.
     */
    const clearFormatting = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      restoreSelection();
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('removeFormat');
      document.execCommand('unlink');
      document.execCommand('formatBlock', false, 'p');
      saveSelection();
      emit();
    }, [emit, restoreSelection, saveSelection]);

    const applyLink = useCallback(() => {
      const url = linkUrl.trim();
      if (!url) return;
      // Thiếu lược đồ ⇒ trình duyệt hiểu là đường dẫn tương đối và link chết khi sang TikTok.
      const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
      exec('createLink', href);
      setLinkOpen(false);
      setLinkUrl('');
    }, [exec, linkUrl]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        insertText: (value: string) => {
          const editor = editorRef.current;
          if (!editor) return;

          if (sourceMode) {
            // Ở chế độ HTML thì vùng soạn thảo là một <textarea> thật — chèn theo selection
            // của nó, giữ nguyên hành vi mà người dùng đã quen từ bản textarea trước đây.
            const area = editor.querySelector('textarea');
            if (!area) return;
            const start = area.selectionStart;
            const end = area.selectionEnd;
            const next = area.value.slice(0, start) + value + area.value.slice(end);
            emittedValue.current = next;
            onChange(next);
            requestAnimationFrame(() => {
              area.focus();
              area.setSelectionRange(start + value.length, start + value.length);
            });
            return;
          }

          editor.focus();
          restoreSelection();
          // `insertText` giữ nguyên văn bản (token `{{…}}` không bị hiểu thành thẻ HTML).
          document.execCommand('insertText', false, value);
          saveSelection();
          emit();
        },
      }),
      [emit, onChange, restoreSelection, saveSelection, sourceMode],
    );

    // --- Chế độ HTML thuần -------------------------------------------------
    if (sourceMode) {
      return (
        <div ref={editorRef} className={cn('rounded-md border', className)}>
          <Toolbar>
            <ToolbarButton
              label={text.sourceMode}
              active
              onClick={() => setSourceMode(false)}
              icon={<Code2 className="size-4" />}
            />
          </Toolbar>
          <textarea
            value={value}
            onChange={(event) => {
              emittedValue.current = event.target.value;
              onChange(event.target.value);
            }}
            spellCheck={false}
            style={{ minHeight }}
            className="w-full resize-y rounded-b-md bg-background p-3 font-mono text-xs outline-none"
            placeholder={placeholder}
          />
        </div>
      );
    }

    // --- Chế độ WYSIWYG ----------------------------------------------------
    return (
      <div className={cn('rounded-md border', className)}>
        <Toolbar>
          <select
            aria-label={text.paragraph}
            defaultValue=""
            onMouseDown={saveSelection}
            onChange={(event) => {
              exec('formatBlock', event.target.value);
              event.target.value = '';
            }}
            className="h-7 rounded border bg-background px-1 text-xs"
          >
            <option value="" disabled>
              {text.paragraph}
            </option>
            <option value="p">{text.paragraph}</option>
            <option value="h1">{text.heading1}</option>
            <option value="h2">{text.heading2}</option>
            <option value="h3">{text.heading3}</option>
          </select>

          <select
            aria-label={text.font}
            defaultValue=""
            onMouseDown={saveSelection}
            onChange={(event) => {
              exec('fontName', event.target.value);
              event.target.value = '';
            }}
            className="h-7 w-[104px] rounded border bg-background px-1 text-xs"
          >
            <option value="" disabled>
              {text.font}
            </option>
            {FONT_OPTIONS.map((font) => (
              <option key={font.label} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>

          <select
            aria-label={text.fontSize}
            defaultValue=""
            onMouseDown={saveSelection}
            onChange={(event) => {
              applyFontSize(event.target.value);
              event.target.value = '';
            }}
            className="h-7 w-[64px] rounded border bg-background px-1 text-xs"
          >
            <option value="" disabled>
              {text.fontSize}
            </option>
            {FONT_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>

          <Divider />

          <ToolbarButton label={text.bold} onClick={() => exec('bold')} icon={<Bold className="size-4" />} />
          <ToolbarButton label={text.italic} onClick={() => exec('italic')} icon={<Italic className="size-4" />} />
          <ToolbarButton
            label={text.underline}
            onClick={() => exec('underline')}
            icon={<Underline className="size-4" />}
          />
          <ToolbarButton
            label={text.strikethrough}
            onClick={() => exec('strikeThrough')}
            icon={<Strikethrough className="size-4" />}
          />

          <ColorPicker label={text.textColor} swatch="A" onSave={saveSelection} onPick={(color) => exec('foreColor', color)} />
          <ColorPicker
            label={text.backgroundColor}
            swatch="▧"
            onSave={saveSelection}
            // `hiliteColor` là lệnh đúng cho màu nền chữ; Chrome/Edge chấp nhận cả `backColor`
            // nhưng Firefox thì `backColor` đổi nền cả khối — dùng `hiliteColor` cho thống nhất.
            onPick={(color) => exec('hiliteColor', color)}
          />

          <Divider />

          <ToolbarButton
            label={text.link}
            active={linkOpen}
            onClick={() => {
              saveSelection();
              setLinkOpen((open) => !open);
            }}
            icon={<Link2 className="size-4" />}
          />
          <ToolbarButton label={text.unlink} onClick={() => exec('unlink')} icon={<Link2Off className="size-4" />} />
          <ToolbarButton
            label={text.blockquote}
            onClick={() => exec('formatBlock', 'blockquote')}
            icon={<Quote className="size-4" />}
          />

          <Divider />

          <ToolbarButton label={text.alignLeft} onClick={() => exec('justifyLeft')} icon={<AlignLeft className="size-4" />} />
          <ToolbarButton
            label={text.alignCenter}
            onClick={() => exec('justifyCenter')}
            icon={<AlignCenter className="size-4" />}
          />
          <ToolbarButton
            label={text.alignRight}
            onClick={() => exec('justifyRight')}
            icon={<AlignRight className="size-4" />}
          />
          <ToolbarButton
            label={text.alignJustify}
            onClick={() => exec('justifyFull')}
            icon={<AlignJustify className="size-4" />}
          />

          <Divider />

          <ToolbarButton
            label={text.bulletList}
            onClick={() => exec('insertUnorderedList')}
            icon={<List className="size-4" />}
          />
          <ToolbarButton
            label={text.numberedList}
            onClick={() => exec('insertOrderedList')}
            icon={<ListOrdered className="size-4" />}
          />
          <ToolbarButton label={text.outdent} onClick={() => exec('outdent')} icon={<Outdent className="size-4" />} />
          <ToolbarButton label={text.indent} onClick={() => exec('indent')} icon={<Indent className="size-4" />} />

          <Divider />

          <ToolbarButton label={text.undo} onClick={() => exec('undo')} icon={<Undo2 className="size-4" />} />
          <ToolbarButton label={text.redo} onClick={() => exec('redo')} icon={<Redo2 className="size-4" />} />
          <ToolbarButton
            label={text.clearFormatting}
            onClick={clearFormatting}
            icon={<RemoveFormatting className="size-4" />}
          />

          <Divider />

          <ToolbarButton
            label={text.sourceMode}
            onClick={() => setSourceMode(true)}
            icon={<Code2 className="size-4" />}
          />
        </Toolbar>

        {linkOpen && (
          <div className="flex items-center gap-2 border-b bg-muted/30 px-2 py-1.5">
            <input
              autoFocus
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyLink();
                }
                if (event.key === 'Escape') setLinkOpen(false);
              }}
              placeholder={text.linkUrl}
              className="h-7 flex-1 rounded border bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={applyLink}
              className="h-7 rounded border px-2 text-xs hover:bg-muted"
            >
              {text.linkApply}
            </button>
            <button
              type="button"
              onClick={() => setLinkOpen(false)}
              className="h-7 rounded px-2 text-xs text-muted-foreground hover:bg-muted"
            >
              {text.linkCancel}
            </button>
          </div>
        )}

        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          aria-label={placeholder}
          data-placeholder={placeholder}
          // Chỉ `onInput` — KHÔNG phát lại ở `onBlur`. Template cũ là văn bản thuần; phát
          // khi rời ô nghĩa là chỉ cần bấm vào rồi bấm ra là nội dung đã âm thầm bị đổi sang
          // HTML dù người dùng chưa gõ chữ nào. `onInput` bắt đủ mọi thay đổi thật (gõ, IME,
          // kéo thả), còn các lệnh trên thanh công cụ đều tự gọi `emit`.
          onInput={emit}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onFocus={saveSelection}
          // 🔴 Dán dưới dạng VĂN BẢN THUẦN. Dán từ Word/Google Docs mang theo hàng chục KB
          // style rác và `<o:p>` của Office — đủ để một mô tả vượt trần 10.000 ký tự của
          // TikTok mà nhìn trên màn hình không thấy gì bất thường.
          onPaste={(event) => {
            event.preventDefault();
            const plain = event.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, plain);
            emit();
          }}
          style={{ minHeight }}
          className={cn(
            'prose-editor w-full overflow-y-auto rounded-b-md bg-background p-3 text-sm outline-none',
            'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
          )}
        />
      </div>
    );
  },
);

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-t-md border-b bg-muted/40 p-1">
      {children}
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />;
}

/**
 * Nút trên thanh công cụ.
 *
 * 🔴 `onMouseDown` phải `preventDefault()`: không có nó, nhấn chuột xuống nút sẽ lấy focus
 * khỏi vùng soạn thảo và XOÁ vùng chọn — lệnh chạy sau đó không còn gì để tác động, và mọi
 * nút định dạng im lặng không làm gì cả.
 */
function ToolbarButton({
  label,
  icon,
  onClick,
  active,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground',
        'hover:bg-background hover:text-foreground',
        active && 'bg-background text-foreground shadow-sm',
      )}
    >
      {icon}
    </button>
  );
}

/**
 * Ô chọn màu — `<input type="color">` gốc của trình duyệt.
 *
 * Bảng màu tự dựng sẽ đẹp hơn nhưng phải tự lo lưới màu, ô tự nhập, bàn phím và tương phản;
 * điều khiển gốc đã có sẵn tất cả và đây không phải chỗ đáng tiêu công vào.
 */
function ColorPicker({
  label,
  swatch,
  onPick,
  onSave,
}: {
  label: string;
  swatch: string;
  onPick: (color: string) => void;
  onSave: () => void;
}) {
  return (
    <label
      title={label}
      aria-label={label}
      onMouseDown={onSave}
      className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-xs font-semibold text-muted-foreground hover:bg-background hover:text-foreground"
    >
      {swatch}
      <input
        type="color"
        onChange={(event) => onPick(event.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </label>
  );
}
