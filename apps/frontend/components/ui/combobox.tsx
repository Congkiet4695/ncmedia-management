'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Một lựa chọn trong danh sách. `hint` hiện mờ bên phải (mã danh mục, tên shop…). */
export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * Số option render tối đa trong một lần mở.
 *
 * 🔴 Danh sách thương hiệu của TikTok có hàng chục nghìn dòng. Đổ hết vào DOM là treo tab
 * trình duyệt, nên chỉ vẽ phần đầu và bảo người dùng gõ để lọc tiếp — rẻ hơn và dễ hiểu hơn
 * một thư viện ảo hoá, mà hiệu quả với người dùng thì như nhau: không ai cuộn tay qua 20.000
 * dòng, họ gõ.
 */
const MAX_RENDERED = 200;

/** Bỏ dấu tiếng Việt để "ao thun" tìm được "áo thun". */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function filterOptions(options: ComboboxOption[], keyword: string): ComboboxOption[] {
  const needle = normalize(keyword);
  if (!needle) return options;
  return options.filter(
    (option) =>
      normalize(option.label).includes(needle) ||
      normalize(option.hint ?? '').includes(needle) ||
      normalize(option.value).includes(needle),
  );
}

// ---------------------------------------------------------------------------
// Khung popover dùng chung
// ---------------------------------------------------------------------------

/**
 * Panel thả xuống, render qua **portal** ở `position: fixed`.
 *
 * 🔴 Vì sao portal: mọi hộp thoại trong hệ thống đều là một khối `overflow-y-auto`. Một
 * dropdown nằm trong luồng sẽ bị chính hộp thoại cắt mất phần dưới. Portal + toạ độ tính từ
 * ô trigger cho danh sách nổi trên tất cả, và tự lật lên trên khi gần đáy màn hình.
 */
function Popover({
  anchor,
  open,
  children,
  onClose,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open || !anchor) return;

    const update = (): void => setRect(anchor.getBoundingClientRect());
    update();

    // `true` = bắt cả sự kiện cuộn của thẻ cha (hộp thoại), không chỉ của window.
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, anchor]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, anchor, onClose]);

  if (!open || !rect || typeof document === 'undefined') return null;

  const spaceBelow = window.innerHeight - rect.bottom;
  const flip = spaceBelow < 280 && rect.top > spaceBelow;

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: rect.left,
        width: rect.width,
        ...(flip ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      }}
      className="z-[100] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
    >
      {children}
    </div>,
    document.body,
  );
}

/** Danh sách option + ô tìm kiếm — phần ruột dùng chung cho cả một-lựa-chọn lẫn nhiều-lựa-chọn. */
function OptionList({
  options,
  keyword,
  onKeywordChange,
  highlighted,
  onHighlight,
  onPick,
  isSelected,
  loading,
  searchPlaceholder,
  emptyMessage,
  footer,
  inputRef,
  onKeyDown,
}: {
  options: ComboboxOption[];
  keyword: string;
  onKeywordChange: (value: string) => void;
  highlighted: number;
  onHighlight: (index: number) => void;
  onPick: (option: ComboboxOption) => void;
  isSelected: (value: string) => boolean;
  loading?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  footer?: React.ReactNode;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { t } = useTranslation('common');
  const listRef = React.useRef<HTMLDivElement>(null);

  // Con trỏ bàn phím phải luôn nằm trong tầm nhìn, kể cả khi danh sách dài.
  React.useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  const visible = options.slice(0, MAX_RENDERED);
  const hidden = options.length - visible.length;

  return (
    <>
      <div className="relative border-b">
        <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={searchPlaceholder ?? t('combobox.searchPlaceholder')}
          className="h-9 w-full bg-transparent pl-7 pr-8 text-sm outline-none placeholder:text-muted-foreground"
        />
        {loading && (
          <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      <div ref={listRef} className="max-h-60 overflow-y-auto py-1">
        {visible.length === 0 && !loading && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {emptyMessage ?? t('combobox.noResult')}
          </p>
        )}

        {visible.map((option, index) => (
          <button
            key={option.value}
            type="button"
            data-index={index}
            disabled={option.disabled}
            onMouseEnter={() => onHighlight(index)}
            // `onMouseDown` thay vì `onClick`: click làm ô tìm kiếm mất focus trước khi
            // `onClick` chạy, và trình duyệt sẽ đóng popover mất lượt chọn.
            onMouseDown={(event) => {
              event.preventDefault();
              if (!option.disabled) onPick(option);
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm disabled:opacity-50',
              index === highlighted && 'bg-accent text-accent-foreground',
            )}
          >
            <Check
              className={cn('size-3.5 shrink-0', isSelected(option.value) ? '' : 'invisible')}
            />
            <span className="flex-1 truncate">{option.label}</span>
            {option.hint && (
              <span className="shrink-0 truncate text-xs text-muted-foreground">{option.hint}</span>
            )}
          </button>
        ))}

        {hidden > 0 && (
          <p className="px-3 py-2 text-center text-xs text-muted-foreground">
            {t('combobox.more', { count: hidden })}
          </p>
        )}
      </div>

      {footer}
    </>
  );
}

// ---------------------------------------------------------------------------
// Combobox — MỘT lựa chọn
// ---------------------------------------------------------------------------

export interface ComboboxProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Có mặt ⇒ **tìm kiếm phía server**: component không tự lọc, chỉ báo từ khoá ra ngoài. */
  onSearchChange?: (keyword: string) => void;
  /** Cho phép bỏ chọn (trả về chuỗi rỗng). */
  clearable?: boolean;
  className?: string;
  id?: string;
}

/**
 * Combobox có tìm kiếm — thay cho `<select>` gốc trong toàn bộ module POD.
 *
 * ```
 *   [ Giá trị đang chọn                      ▾ ]
 *   ┌──────────────────────────────────────────┐
 *   │ 🔍 gõ để lọc…                            │
 *   │ ✓ US Tee — Comfort Colors                │
 *   │   UK Hoodie                              │
 *   └──────────────────────────────────────────┘
 * ```
 *
 * Bàn phím: ↓/↑ di chuyển · Enter chọn · Esc đóng · Tab đóng. Mở ra là con trỏ nằm sẵn ở ô
 * tìm kiếm, đúng như Seller Center.
 *
 * 🔴 `onSearchChange` là ranh giới giữa hai chế độ: không truyền thì lọc tại chỗ (danh sách
 * ngắn, đã nạp đủ); có truyền thì component KHÔNG lọc gì cả mà giao việc cho server — bắt
 * buộc với những danh sách như thương hiệu, nơi tải hết về máy là không tưởng.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled,
  loading,
  onSearchChange,
  clearable,
  className,
  id,
}: ComboboxProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const [highlighted, setHighlighted] = React.useState(0);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const serverSide = Boolean(onSearchChange);
  const filtered = React.useMemo(
    () => (serverSide ? options : filterOptions(options, keyword)),
    [options, keyword, serverSide],
  );
  const selected = options.find((option) => option.value === value) ?? null;

  const close = React.useCallback((): void => {
    setOpen(false);
    setKeyword('');
    onSearchChange?.('');
  }, [onSearchChange]);

  React.useEffect(() => {
    if (!open) return;
    setHighlighted(0);
    // Focus phải chờ panel gắn vào DOM.
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  const pick = (option: ComboboxOption): void => {
    onChange(option.value);
    close();
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[highlighted];
      if (option && !option.disabled) pick(option);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      close();
      if (event.key === 'Escape') triggerRef.current?.focus();
    }
  };

  return (
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected?.label ?? placeholder ?? t('combobox.placeholder')}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {clearable && selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label={t('combobox.clear')}
              onClick={(event) => {
                event.stopPropagation();
                onChange('');
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </span>
          )}
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </span>
      </button>

      <Popover anchor={triggerRef.current} open={open} onClose={close}>
        <OptionList
          options={filtered}
          keyword={keyword}
          onKeywordChange={(next) => {
            setKeyword(next);
            setHighlighted(0);
            onSearchChange?.(next);
          }}
          highlighted={highlighted}
          onHighlight={setHighlighted}
          onPick={pick}
          isSelected={(candidate) => candidate === value}
          loading={loading}
          searchPlaceholder={searchPlaceholder}
          emptyMessage={emptyMessage}
          inputRef={inputRef}
          onKeyDown={onKeyDown}
        />
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------------------
// MultiCombobox — NHIỀU lựa chọn
// ---------------------------------------------------------------------------

export interface MultiComboboxProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  onSearchChange?: (keyword: string) => void;
  /**
   * Cho phép Enter biến từ khoá đang gõ thành một giá trị mới.
   *
   * 🔴 Chỉ bật khi TikTok cho phép thuộc tính đó nhập tự do (`is_customizable`) — không phải
   * mặc định, và backend cũng từ chối nếu ai đó gọi thẳng API.
   */
  allowCustomValue?: boolean;
  /** Nhãn cho giá trị tự nhập (không có trong `options`). */
  customLabel?: (value: string) => string;
  className?: string;
  id?: string;
}

/**
 * Combobox nhiều lựa chọn: tag + tìm kiếm + bàn phím.
 *
 * Bàn phím: ↓/↑ di chuyển · Enter chọn (hoặc thêm giá trị tự nhập) · **Backspace ở ô rỗng xoá
 * tag cuối** · Esc đóng.
 */
export function MultiCombobox({
  values,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled,
  loading,
  onSearchChange,
  allowCustomValue,
  customLabel,
  className,
  id,
}: MultiComboboxProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const [highlighted, setHighlighted] = React.useState(0);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const serverSide = Boolean(onSearchChange);
  const filtered = React.useMemo(
    () => (serverSide ? options : filterOptions(options, keyword)),
    [options, keyword, serverSide],
  );

  const close = React.useCallback((): void => {
    setOpen(false);
    setKeyword('');
    onSearchChange?.('');
  }, [onSearchChange]);

  React.useEffect(() => {
    if (!open) return;
    setHighlighted(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  const toggle = (candidate: string): void => {
    onChange(
      values.includes(candidate)
        ? values.filter((item) => item !== candidate)
        : [...values, candidate],
    );
    setKeyword('');
    onSearchChange?.('');
    inputRef.current?.focus();
  };

  const addCustom = (): void => {
    const custom = keyword.trim();
    if (!custom) return;
    // Gõ trùng tên một option có sẵn ⇒ chọn chính option đó, đừng đẻ thêm bản sao tự nhập.
    const existing = options.find(
      (option) => normalize(option.label) === normalize(custom) || option.value === custom,
    );
    toggle(existing?.value ?? custom);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // 🔴 Enter LUÔN ưu tiên mục đang được con trỏ chỉ vào. Gõ "8" mà danh sách đang sáng
      // ở `8"x12"` thì Enter phải chọn nó, không phải đẻ ra một giá trị tự nhập tên "8".
      // Muốn giá trị tự nhập thì gõ tới khi không còn mục nào khớp, hoặc bấm dòng "Thêm …".
      const option = filtered[highlighted];
      if (option && !option.disabled) toggle(option.value);
      else if (allowCustomValue) addCustom();
    } else if (event.key === 'Backspace' && !keyword && values.length > 0) {
      // Ô tìm kiếm rỗng ⇒ Backspace xoá tag cuối, đúng thói quen của mọi ô tag.
      onChange(values.slice(0, -1));
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      close();
      if (event.key === 'Escape') triggerRef.current?.focus();
    }
  };

  const labelOf = (candidate: string): string =>
    options.find((option) => option.value === candidate)?.label ??
    customLabel?.(candidate) ??
    candidate;

  return (
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          'flex min-h-10 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5 text-left text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        {values.length === 0 && (
          <span className="px-1 text-muted-foreground">
            {placeholder ?? t('combobox.placeholder')}
          </span>
        )}
        {values.map((candidate) => (
          <span
            key={candidate}
            className="inline-flex max-w-full items-center gap-1 rounded border bg-muted/50 px-1.5 py-0.5 text-xs"
          >
            <span className="truncate">{labelOf(candidate)}</span>
            {!disabled && (
              <span
                role="button"
                tabIndex={-1}
                aria-label={t('combobox.remove')}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(values.filter((item) => item !== candidate));
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </span>
            )}
          </span>
        ))}
        <ChevronDown className="ml-auto size-4 shrink-0 opacity-50" />
      </button>

      <Popover anchor={triggerRef.current} open={open} onClose={close}>
        <OptionList
          options={filtered}
          keyword={keyword}
          onKeywordChange={(next) => {
            setKeyword(next);
            setHighlighted(0);
            onSearchChange?.(next);
          }}
          highlighted={highlighted}
          onHighlight={setHighlighted}
          onPick={(option) => toggle(option.value)}
          isSelected={(candidate) => values.includes(candidate)}
          loading={loading}
          searchPlaceholder={searchPlaceholder}
          emptyMessage={emptyMessage}
          inputRef={inputRef}
          onKeyDown={onKeyDown}
          footer={
            allowCustomValue && keyword.trim() ? (
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  addCustom();
                }}
                className="w-full border-t px-3 py-2 text-left text-sm hover:bg-accent"
              >
                {t('combobox.addCustom', { value: keyword.trim() })}
              </button>
            ) : null
          }
        />
      </Popover>
    </>
  );
}
