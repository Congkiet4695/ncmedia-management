# Frontend Design System — NCMedia Management Platform

> **Loại tài liệu:** Design System (Source of Truth cho UI Frontend)
> **Ngày:** 2026-07-15 · **Áp dụng cho:** `apps/frontend` (Next.js 15 · React 19 · TailwindCSS v3 · shadcn/ui)
> **Nguồn tuân thủ:** `.claude/CLAUDE.md` (Mục 7, 8, 12, 13, 14), `architecture/ADR.md` (ADR-010, 017, 022, 023, 006/021), `FRONTEND_BOOTSTRAP_REVIEW.md`
>
> Tài liệu **chỉ đặc tả thiết kế** (design spec) — không phải code triển khai. Token & convention ở đây là chuẩn bắt buộc; component thực tế thêm dần bằng shadcn/ui theo đúng spec này.

---

## Mục lục

1. [Nguyên tắc & Governance](#1-nguyên-tắc--governance)
2. [Theme & Design Tokens](#2-theme--design-tokens)
3. [Color Palette](#3-color-palette)
4. [Typography](#4-typography)
5. [Spacing](#5-spacing)
6. [Border Radius](#6-border-radius)
7. [Shadow / Elevation](#7-shadow--elevation)
8. [Button Variant](#8-button-variant)
9. [Input Variant](#9-input-variant)
10. [Card](#10-card)
11. [Dialog](#11-dialog)
12. [Toast](#12-toast)
13. [Badge](#13-badge)
14. [Table](#14-table)
15. [Pagination](#15-pagination)
16. [Skeleton](#16-skeleton)
17. [Loading](#17-loading)
18. [Empty State](#18-empty-state)
19. [404 — Not Found](#19-404--not-found)
20. [500 — Server Error](#20-500--server-error)
21. [Responsive](#21-responsive)
22. [Dark Mode Strategy](#22-dark-mode-strategy)
23. [Permission Rendering](#23-permission-rendering)
24. [Form Convention](#24-form-convention)
25. [API Error Convention](#25-api-error-convention)
26. [Accessibility](#26-accessibility)

---

## 1. Nguyên tắc & Governance

**Nguyên tắc thiết kế**
- **Token-first:** mọi màu/spacing/radius phải tham chiếu **design token** (CSS variable / Tailwind theme). **KHÔNG hardcode** giá trị màu hex trong component (CLAUDE.md Mục 8 — No Hardcode).
- **shadcn/ui làm nền:** primitive dùng chuẩn shadcn (copy-in, không phải package). Không tự vẽ lại component đã có primitive.
- **Consistency > sáng tạo cục bộ:** một pattern cho một vấn đề (KISS/DRY).
- **Accessible by default:** focus ring, contrast AA, keyboard, ARIA.
- **Đa tenant / đa ngôn ngữ:** nội dung UI tiếng Việt; không nhúng dữ liệu tổ chức vào token.

**Source of Truth**
| Loại | Vị trí |
|---|---|
| Design token (màu, radius) | `styles/globals.css` (CSS variables) |
| Mapping token → utility | `tailwind.config.ts` (`theme.extend`) |
| Helper class merge | `lib/utils.ts` → `cn()` |
| Component primitive | `components/ui/*` (shadcn) |
| Cấu hình shadcn | `components.json` |

**Quy tắc thay đổi token:** chỉ Frontend Tech Lead duyệt; sửa ở `globals.css` + `tailwind.config.ts`, không sửa rải rác trong component.

---

## 2. Theme & Design Tokens

Hệ token dùng **HSL không bọc `hsl()`** (chuẩn shadcn) — cho phép thêm alpha qua Tailwind (`bg-primary/90`). Có **2 theme**: `:root` (light) và `.dark` (dark).

**Token ngữ nghĩa (semantic tokens) — đã có trong bootstrap:**

| Token | Vai trò | Ví dụ dùng |
|---|---|---|
| `--background` / `--foreground` | Nền & chữ toàn trang | `bg-background text-foreground` |
| `--card` / `--card-foreground` | Bề mặt Card | `bg-card` |
| `--popover` / `--popover-foreground` | Bề mặt nổi (dropdown, popover) | `bg-popover` |
| `--primary` / `--primary-foreground` | Hành động chính, nhấn mạnh | `bg-primary` |
| `--secondary` / `--secondary-foreground` | Hành động phụ | `bg-secondary` |
| `--muted` / `--muted-foreground` | Nền mờ, text phụ | `text-muted-foreground` |
| `--accent` / `--accent-foreground` | Hover/nền tương tác nhẹ | `hover:bg-accent` |
| `--destructive` / `--destructive-foreground` | Nguy hiểm/xoá/lỗi | `bg-destructive` |
| `--border` | Viền | `border` |
| `--input` | Viền input | `border-input` |
| `--ring` | Vòng focus | `focus-visible:ring-ring` |
| `--radius` | Bo góc gốc (0.5rem) | dẫn xuất `lg/md/sm` |

**Đề xuất mở rộng (bổ sung vào `globals.css` khi làm nghiệp vụ)** — cần cho Badge/Toast/Status mà bootstrap chưa có:

| Token | Vai trò |
|---|---|
| `--success` / `--success-foreground` | Thành công, trạng thái tích cực (đơn hoàn tất) |
| `--warning` / `--warning-foreground` | Cảnh báo, chờ xử lý |
| `--info` / `--info-foreground` | Thông tin trung tính |

> Các token này giữ nguyên tắc HSL-không-hsl() như trên; map vào `tailwind.config.ts` giống `destructive`.

---

## 3. Color Palette

**Base color:** `slate` (shadcn). Bảng giá trị token (HSL) — chuẩn chính thức:

### 3.1. Light (`:root`)
| Token | HSL |
|---|---|
| background | `0 0% 100%` |
| foreground | `222.2 84% 4.9%` |
| primary | `222.2 47.4% 11.2%` |
| primary-foreground | `210 40% 98%` |
| secondary | `210 40% 96.1%` |
| muted | `210 40% 96.1%` |
| muted-foreground | `215.4 16.3% 46.9%` |
| accent | `210 40% 96.1%` |
| destructive | `0 84.2% 60.2%` |
| border / input | `214.3 31.8% 91.4%` |
| ring | `222.2 84% 4.9%` |

### 3.2. Dark (`.dark`)
| Token | HSL |
|---|---|
| background | `222.2 84% 4.9%` |
| foreground | `210 40% 98%` |
| primary | `210 40% 98%` |
| secondary / muted / accent | `217.2 32.6% 17.5%` |
| muted-foreground | `215 20.2% 65.1%` |
| destructive | `0 62.8% 30.6%` |
| border / input | `217.2 32.6% 17.5%` |
| ring | `212.7 26.8% 83.9%` |

### 3.3. Màu trạng thái ngữ nghĩa (semantic status)
Dùng cho Badge / Toast / trạng thái đơn hàng, tài khoản… (giá trị đề xuất, HSL):

| Ý nghĩa | Light | Dark | Ứng dụng |
|---|---|---|---|
| Success | `142 71% 45%` | `142 70% 45%` | ACTIVE, đơn hoàn tất, lưu thành công |
| Warning | `38 92% 50%` | `38 92% 50%` | Chờ xử lý, TRIAL, sắp hết hạn |
| Info | `221 83% 53%` | `217 91% 60%` | Thông báo trung tính |
| Destructive | (token sẵn có) | | SUSPENDED, xoá, lỗi |

> **Nguyên tắc màu:** không dùng màu để truyền tải ý nghĩa **duy nhất** (kèm icon/label) — hỗ trợ người mù màu. Contrast tối thiểu **WCAG AA** (4.5:1 cho text thường).

---

## 4. Typography

**Font family:** system font-stack (không tải Google Fonts để tránh phụ thuộc mạng lúc build). Tailwind `font-sans` mặc định (`ui-sans-serif, system-ui, ...`). Mono cho mã/kỹ thuật: `font-mono`.

**Type scale** (Tailwind utility · dùng cho ngữ cảnh nào):

| Token | Size / Line-height | Weight | Dùng cho |
|---|---|---|---|
| `text-4xl` | 36/40px | 700 | Trang tiêu đề lớn, 404/500 heading |
| `text-3xl` | 30/36px | 700 | Tiêu đề trang (H1) |
| `text-2xl` | 24/32px | 600 | Tiêu đề section (H2) |
| `text-xl` | 20/28px | 600 | Tiêu đề card lớn (H3) |
| `text-lg` | 18/28px | 600 | Card title, dialog title |
| `text-base` | 16/24px | 400 | Body mặc định |
| `text-sm` | 14/20px | 400/500 | Body phụ, label, input text, table cell |
| `text-xs` | 12/16px | 500 | Caption, helper text, badge, meta |

**Quy ước**
- Tiêu đề: `font-semibold`/`font-bold`, `tracking-tight`.
- Label form & badge: `text-sm font-medium` / `text-xs font-medium uppercase tracking-wide`.
- Text phụ/mô tả: `text-muted-foreground`.
- Số liệu (tiền, doanh thu): `tabular-nums`, canh phải trong bảng.
- Giới hạn độ dài dòng đọc: `max-w-prose` cho đoạn văn dài; cắt dài bằng `truncate` / `line-clamp-*`.

---

## 5. Spacing

**Base unit = 4px** (thang Tailwind: `1` = 4px, `2` = 8px, `4` = 16px…). Chỉ dùng bội số của thang; **không** giá trị lẻ tuỳ ý.

**Spacing tokens ngữ nghĩa (khuyến nghị áp dụng nhất quán):**

| Ngữ cảnh | Giá trị | Tailwind |
|---|---|---|
| Padding trong Input/Button (dọc/ngang) | 8 / 16px | `py-2 px-4` |
| Padding Card | 24px | `p-6` (header/content), `p-4` cho card gọn |
| Gap giữa field trong form | 16–24px | `space-y-4` / `space-y-6` |
| Gap grid card/dashboard | 16px | `gap-4` |
| Padding trang (page container) | 16px mobile → 24–32px desktop | `px-4 md:px-6 lg:px-8` |
| Khoảng cách giữa section | 32–48px | `space-y-8` / `space-y-12` |
| Gap icon–label trong nút | 8px | `gap-2` |

**Rhythm dọc:** ưu tiên `space-y-*` cho stack; dùng `gap-*` trong flex/grid. Tránh margin chồng lấn (collapsing) — dùng gap của container.

---

## 6. Border Radius

Gốc `--radius: 0.5rem` (8px). Dẫn xuất trong `tailwind.config.ts`:

| Token | Công thức | Giá trị | Dùng cho |
|---|---|---|---|
| `rounded-lg` | `var(--radius)` | 8px | Card, Dialog, Popover, Button lớn |
| `rounded-md` | `radius - 2px` | 6px | Button, Input, Badge, Dropdown item |
| `rounded-sm` | `radius - 4px` | 4px | Chip nhỏ, checkbox |
| `rounded-full` | — | tròn | Avatar, icon button tròn, trạng thái chấm |

**Quy ước:** thống nhất `rounded-md` cho control (button/input) để đồng bộ; `rounded-lg` cho surface (card/dialog).

---

## 7. Shadow / Elevation

Bóng tối giản (shadcn-style), tăng theo độ nổi. Trong dark mode giảm/nhẹ bóng, ưu tiên border để tách lớp.

| Cấp | Tailwind | Dùng cho |
|---|---|---|
| 0 — Flat | `shadow-none` + `border` | Card mặc định, khối nội dung |
| 1 — Raised | `shadow-sm` | Card nhấn nhẹ, sticky header |
| 2 — Overlay | `shadow-md` | Dropdown, Popover, Select |
| 3 — Modal | `shadow-lg` | Dialog, Sheet, Command palette |
| 4 — Peak | `shadow-xl` | Toast, notification nổi |

**Nguyên tắc:** elevation đi kèm nền (`bg-popover`/`bg-card`) và thường có `border`. Không dùng bóng để thay thế phân cấp bằng khoảng trắng.

---

## 8. Button Variant

Theo primitive `components/ui/button.tsx` (cva). **Variant** × **Size** như sau:

**Variant**
| Variant | Ý nghĩa | Spec màu |
|---|---|---|
| `default` | Hành động chính | `bg-primary text-primary-foreground hover:bg-primary/90` |
| `secondary` | Hành động phụ | `bg-secondary text-secondary-foreground hover:bg-secondary/80` |
| `outline` | Hành động trung tính, viền | `border border-input bg-background hover:bg-accent` |
| `ghost` | Ẩn nền, dùng trong toolbar/menu | `hover:bg-accent hover:text-accent-foreground` |
| `link` | Trông như liên kết | `text-primary underline-offset-4 hover:underline` |
| `destructive` | Xoá/nguy hiểm | `bg-destructive text-destructive-foreground hover:bg-destructive/90` |

**Size**
| Size | Cao | Padding | Dùng |
|---|---|---|---|
| `sm` | 36px (`h-9`) | `px-3` | Toolbar, inline, table row action |
| `default` | 40px (`h-10`) | `px-4 py-2` | Mặc định form/CTA |
| `lg` | 44px (`h-11`) | `px-8` | CTA nổi bật |
| `icon` | 40×40 (`h-10 w-10`) | — | Nút chỉ icon |

**States:** `hover`, `focus-visible:ring-2 ring-ring ring-offset-2`, `disabled:opacity-50 pointer-events-none`, **loading** (xem [§17](#17-loading)): hiện spinner + `disabled`, giữ nguyên chiều rộng, ẩn/giữ label.

**Quy ước dùng**
- Mỗi khu vực chỉ **một** nút `default` (primary) để dẫn hướng.
- Xoá luôn dùng `destructive` + xác nhận qua Dialog.
- Icon trong nút: `size-4`, đặt trước label, `gap-2`.
- Nút nguy hiểm/không hồi phục: kèm bước xác nhận.

---

## 9. Input Variant

**Anatomy field:** `Label` → `Control` → `Helper text` (tuỳ chọn) → `Error message`.

**Base control spec:** `h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm`, `focus-visible:ring-2 ring-ring ring-offset-2`, `placeholder:text-muted-foreground`, `disabled:opacity-50`.

**Loại control (primitive shadcn cần thêm khi làm form):**
| Control | Ghi chú |
|---|---|
| Input (text/email/number/password) | password kèm nút hiện/ẩn (icon button `ghost`) |
| Textarea | `min-h-20`, resize dọc |
| Select | dùng nền `popover`, elevation cấp 2 |
| Checkbox / Radio | `rounded-sm` / `rounded-full`, focus ring |
| Switch | cho boolean setting |
| Combobox / MultiSelect | search + chips |
| DatePicker | cho ngày (đơn hàng, sinh nhật) |

**States:** `default`, `focus`, `disabled`, `readonly`, `error` (viền + ring dùng `--destructive`), `success` (tuỳ chọn, hiếm dùng).

**Error state spec:** `border-destructive focus-visible:ring-destructive`; message `text-sm text-destructive`; set `aria-invalid="true"` + `aria-describedby` trỏ tới message.

**Quy ước**
- Luôn có `Label` (không dùng placeholder thay label).
- Trường bắt buộc: dấu `*` màu `destructive` sau label.
- Helper text: `text-xs text-muted-foreground`.
- Số/tiền: canh phải, `tabular-nums`, có đơn vị.

---

## 10. Card

**Vai trò:** khối nội dung/nhóm thông tin (thống kê, form section, list item).

**Anatomy:** `Card` (`rounded-lg border bg-card text-card-foreground`) → `CardHeader` (`p-6`, chứa `CardTitle` `text-lg font-semibold` + `CardDescription` `text-sm text-muted-foreground`) → `CardContent` (`p-6 pt-0`) → `CardFooter` (`p-6 pt-0`, hành động).

**Biến thể**
| Loại | Đặc điểm |
|---|---|
| Default | flat + border |
| Stat/KPI | số lớn `text-2xl font-bold` + label muted + icon/trend |
| Interactive | `hover:shadow-sm`/`hover:border-foreground/20`, dùng khi cả card click được |

**Responsive:** grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3/4 gap-4`. Padding card giảm còn `p-4` trên mobile nếu cần.

---

## 11. Dialog

**Vai trò:** tác vụ ngắt luồng cần tập trung (xác nhận xoá, form nhanh). Tác vụ dài/nhiều field → cân nhắc trang riêng hoặc Sheet.

**Anatomy:** `Overlay` (nền mờ `bg-black/50`) → `Content` (`bg-popover`/`bg-card`, `rounded-lg`, `shadow-lg`, canh giữa, `max-w-lg`) → `Header` (`DialogTitle` `text-lg font-semibold` + `DialogDescription`) → `Body` → `Footer` (nút, canh phải: `[Huỷ]` `outline` + `[Xác nhận]` `default`/`destructive`).

**Hành vi & a11y**
- Focus trap; `Esc` để đóng; click overlay đóng (trừ form có thay đổi chưa lưu → confirm).
- `role="dialog"` + `aria-labelledby`/`aria-describedby`.
- Khoá scroll nền khi mở.

**Confirm Dialog (destructive):** tiêu đề rõ hành động, mô tả hệ quả không hồi phục, nút chính `destructive`, ưu tiên focus vào `[Huỷ]`.

**Responsive:** mobile → chuyển sang **Sheet/Drawer** full-width trượt từ dưới/bên để dễ thao tác một tay.

---

## 12. Toast

**Vai trò:** phản hồi ngắn, không ngắt luồng (sau khi lưu/xoá/lỗi mạng).

**Loại & màu**
| Loại | Token | Icon | Dùng |
|---|---|---|---|
| Success | success | check-circle | Lưu/tạo/cập nhật thành công |
| Error | destructive | alert-circle | Thao tác thất bại |
| Warning | warning | alert-triangle | Cảnh báo (sắp hết hạn…) |
| Info | info | info | Thông tin trung tính |

**Spec:** góc màn hình (mặc định **top-right** desktop, **top-center/full-width** mobile), elevation cấp 4, `rounded-md`, tự đóng sau **4–6s** (error có thể lâu hơn / có nút đóng). Tối đa hiển thị ~3 toast, xếp chồng.

**Anatomy:** icon + `title` (`text-sm font-medium`) + `description` (`text-xs text-muted-foreground`) + action tuỳ chọn (`[Hoàn tác]`) + nút đóng.

**Quy ước:** dùng cho phản hồi hành động; **không** dùng toast cho lỗi validate từng field (đó là inline — xem [§25](#25-api-error-convention)). Không nhồi thông tin quan trọng cần đọc kỹ vào toast.

---

## 13. Badge

**Vai trò:** nhãn trạng thái/nhóm ngắn (status tài khoản, trạng thái đơn, role).

**Variant**
| Variant | Spec | Dùng |
|---|---|---|
| `default` | `bg-primary text-primary-foreground` | nhãn nhấn |
| `secondary` | `bg-secondary text-secondary-foreground` | nhãn trung tính |
| `outline` | `border text-foreground` | nhãn nhẹ |
| `success` | nền `success` mờ + chữ success | ACTIVE, hoàn tất |
| `warning` | nền `warning` mờ | TRIAL, chờ xử lý |
| `destructive` | nền `destructive` mờ | SUSPENDED, huỷ, lỗi |

**Spec:** `inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-medium`, tuỳ chọn chấm màu (`size-1.5 rounded-full`) đứng trước.

**Mapping trạng thái nghiệp vụ (chuẩn hoá — dùng chung toàn app):**
| Domain | Giá trị | Badge |
|---|---|---|
| UserStatus | ACTIVE | success |
| | INACTIVE | secondary |
| | LOCKED | warning |
| | SUSPENDED | destructive |
| OrganizationStatus | ACTIVE | success |
| | TRIAL | warning |
| | SUSPENDED | destructive |
| | DELETED | secondary/outline |

> Tạo một **map trạng thái → variant + nhãn tiếng Việt** dùng chung (một nguồn), tránh lặp ở mỗi màn hình (DRY).

---

## 14. Table

**Vai trò:** danh sách dữ liệu nghiệp vụ (Employee, Order, Shop Account…). Kết hợp với [Pagination §15](#15-pagination).

**Anatomy:** `Toolbar` (search, filter, action, nút tạo) → `Table` (`Header` sticky, `Body`, `Row`) → `Footer` (pagination + tổng).

**Spec ô/hàng**
- Header: `text-xs font-medium uppercase tracking-wide text-muted-foreground`, canh theo kiểu dữ liệu.
- Cell: `text-sm`, `py-3 px-4`, `border-b`.
- Row hover: `hover:bg-muted/50`; row chọn: `bg-muted`.
- Số/tiền: canh phải `tabular-nums`; ngày: định dạng nhất quán (vd `dd/MM/yyyy`); trạng thái: Badge; hành động: cụm icon button `ghost`/menu `⋯` cuối hàng.

**States (bắt buộc thiết kế đủ):**
| State | Hiển thị |
|---|---|
| Loading | Skeleton rows (xem §16) |
| Empty (chưa có data) | Empty State trong khung bảng (§18) |
| Empty (lọc không ra) | Empty State kiểu "no results" + nút xoá lọc |
| Error | thông báo lỗi + nút thử lại |
| Populated | dữ liệu + pagination |

**Tính năng chuẩn:** sort theo cột (server-side), filter, tìm kiếm, chọn nhiều (checkbox) nếu cần bulk action, cột hành động cố định phải.

**Responsive:** trên mobile chuyển **table → danh sách Card** (mỗi hàng thành 1 card key-value) hoặc cho cuộn ngang có shadow gợi ý; ẩn cột ít quan trọng theo breakpoint.

**Permission:** cột/hành động (sửa/xoá) chỉ render theo quyền — xem [§23](#23-permission-rendering).

---

## 15. Pagination

Theo **ADR-023**: `page/limit`; response `meta: { total, page, limit, totalPages }`. UI phân trang bám đúng meta này.

**Anatomy:** `[« Trước]  1 … 4 5 [6] 7 8 … 20  [Sau »]` + chọn `limit` (`10 / 20 / 50 / 100`) + text tổng: *"Hiển thị 101–120 / 340"*.

**Spec & hành vi**
- Nút Trước/Sau disabled khi ở trang đầu/cuối (`page === 1` / `page === totalPages`).
- Trang hiện tại nổi bật (`default`), còn lại `ghost`/`outline`; rút gọn bằng `…` khi nhiều trang.
- `limit` mặc định **20**; đổi `limit` reset về `page = 1`.
- Đồng bộ `page/limit` với **URL query** (`?page=&limit=`) để chia sẻ/back-forward hoạt động.
- `total = 0` → không render pagination, hiển thị Empty State.

**Responsive:** mobile rút gọn còn `[Trước] Trang 6/20 [Sau]` + chọn limit trong menu.

---

## 16. Skeleton

**Vai trò:** giữ layout khi tải dữ liệu lần đầu (giảm cảm giác chờ, tránh layout shift).

**Spec:** khối `bg-muted animate-pulse rounded-md` mô phỏng đúng hình dạng nội dung thật (dòng text = `h-4`, avatar = `rounded-full`, nút = `h-10`).

**Dùng khi**
- Tải **lần đầu** một khối/nội dung có cấu trúc biết trước (table rows, card, profile).
- **Không** dùng skeleton cho hành động ngắn (submit) — đó là spinner/loading nút.

**Quy ước:** số lượng skeleton row ≈ số hàng thường thấy (vd 5–10); dừng khi có data hoặc chuyển Empty/Error state. Tôn trọng `prefers-reduced-motion` (giảm pulse).

---

## 17. Loading

Phân biệt rõ **Skeleton** (chờ layout có cấu trúc) vs **Loading spinner** (chờ hành động/vô định hình).

| Ngữ cảnh | Pattern |
|---|---|
| Submit form / nút | Spinner trong Button + `disabled`, giữ chiều rộng, đổi label ("Đang lưu…") |
| Tải trang / route | `loading.tsx` (App Router) với Skeleton hoặc spinner giữa vùng nội dung |
| Tải trong khối/card | Spinner căn giữa khối, chiều cao tối thiểu ổn định |
| Refetch nền (đã có data) | Chỉ báo mờ (top progress bar / opacity nhẹ), **không** che data cũ |
| Chặn toàn màn (hiếm) | Overlay + spinner — chỉ cho thao tác nguy hiểm cần khoá |

**Spec spinner:** icon xoay `size-4`/`size-5`, màu `currentColor`/`text-muted-foreground`, `animate-spin`. Ngưỡng hiển thị: nếu chờ < ~300ms cân nhắc không nháy spinner (tránh flicker).

---

## 18. Empty State

**Vai trò:** thay thế nội dung khi không có dữ liệu — hướng dẫn hành động tiếp theo.

**Anatomy:** `Icon` (muted) → `Title` (`text-lg font-semibold`) → `Description` (`text-sm text-muted-foreground`, 1–2 dòng) → `Action` (nút chính, tuỳ chọn).

**Biến thể (thiết kế đủ)**
| Loại | Thông điệp | Action |
|---|---|---|
| No data (chưa tạo gì) | "Chưa có {đối tượng} nào." | `[Tạo mới]` (nếu có quyền) |
| No results (lọc/search) | "Không tìm thấy kết quả phù hợp." | `[Xoá bộ lọc]` |
| No permission | "Bạn không có quyền xem nội dung này." | về trang trước |
| Error (tải lỗi) | "Không tải được dữ liệu." | `[Thử lại]` |

**Quy ước:** giọng văn tích cực, ngắn gọn; action gắn quyền (ẩn `[Tạo mới]` nếu thiếu permission — [§23](#23-permission-rendering)).

---

## 19. 404 — Not Found

**Vai trò:** route không tồn tại hoặc resource không tìm thấy (App Router `not-found.tsx`).

**Layout:** căn giữa màn — mã lỗi lớn `404` (`text-4xl+ font-bold`) → tiêu đề "Không tìm thấy trang" → mô tả ngắn → hành động `[Về trang chủ]` (+ `[Quay lại]`). Icon minh hoạ muted, tông trung tính.

**Quy ước**
- Không đổ lỗi kỹ thuật; giọng thân thiện tiếng Việt.
- Có link điều hướng an toàn (dashboard theo quyền của user).
- Giữ nhất quán layout/branding với app (không trang trắng trơ).

---

## 20. 500 — Server Error

**Vai trò:** lỗi runtime/ server (App Router `error.tsx` — error boundary) hoặc lỗi API 5xx.

**Layout:** mã `500` → "Đã có lỗi xảy ra" → mô tả trung lập ("Hệ thống gặp sự cố, vui lòng thử lại.") → `[Thử lại]` (reset boundary) + `[Về trang chủ]`.

**Quy ước bảo mật/UX**
- **KHÔNG** lộ stack trace / chi tiết nội bộ ra người dùng (chỉ log phía dev).
- `[Thử lại]` gọi `reset()` của error boundary hoặc refetch.
- Phân biệt: lỗi cả trang → trang 500; lỗi một khối → hiển thị lỗi cục bộ + retry (không sập cả trang).
- Kết hợp Toast cho lỗi thao tác lẻ (không cần chuyển sang trang 500).

---

## 21. Responsive

**Chiến lược:** **Mobile-first**. Breakpoints (Tailwind):

| Breakpoint | Min-width | Ngữ cảnh |
|---|---|---|
| (base) | 0 | Mobile |
| `sm` | 640px | Mobile ngang / tablet nhỏ |
| `md` | 768px | Tablet |
| `lg` | 1024px | Desktop nhỏ / laptop |
| `xl` | 1280px | Desktop |
| `2xl` | 1400px (container) | Desktop lớn |

**Container:** căn giữa, `padding 2rem`, `max-width 1400px` tại `2xl` (theo `tailwind.config.ts`).

**Pattern chuyển đổi (bắt buộc):**
- **Navigation:** sidebar cố định (desktop) → thu gọn/off-canvas Drawer (mobile), điều khiển bằng `useUiStore.sidebarOpen`.
- **Table → Card list** trên mobile (xem §14).
- **Dialog → Sheet/Drawer** trên mobile (xem §11).
- **Grid:** `grid-cols-1` → tăng cột theo `sm/lg`.
- **Ẩn/hiện cột & thông tin thứ yếu** theo breakpoint; hành động chính luôn thấy được.

**Nguyên tắc:** target chạm tối thiểu 40×40px; không dựa vào hover cho chức năng thiết yếu (mobile không có hover).

---

## 22. Dark Mode Strategy

**Chiến lược:** **class-based** — `darkMode: ['class']` (đã cấu hình). Theme đổi bằng cách thêm/bỏ class `dark` ở `<html>`; toàn bộ token tự hoán đổi qua CSS variables `.dark` → **không** cần sửa component.

**Cơ chế đề xuất (khi triển khai toggle):**
- Dùng thư viện `next-themes` (đề xuất bổ sung) để: đọc `prefers-color-scheme`, lưu lựa chọn (localStorage), set `class` trên `<html>` trước khi paint → **tránh flash (FOUC)**.
- `<html suppressHydrationWarning>` đã bật sẵn ở `app/layout.tsx` để tương thích việc set class phía client.
- Chế độ: `light` / `dark` / `system` (mặc định `system`).
- Toggle đặt ở header/settings; icon mặt trời/mặt trăng (lucide `Sun`/`Moon`).

**Quy ước thiết kế cho dark mode**
- Luôn dùng token ngữ nghĩa (`bg-background`, `text-foreground`…), **không** màu cứng → tự đúng ở cả 2 theme.
- Dark mode: giảm bóng, tăng vai trò `border` để tách lớp.
- Kiểm tra contrast AA ở **cả hai** theme.
- Ảnh/biểu đồ: cấp bảng màu phù hợp từng theme (không để màu cháy trên nền tối).

---

## 23. Permission Rendering

Bám **ADR-010** (permission `resource.action`, gán cho Role) + **Decision-007** (một User một Role). Nguồn quyền: `GET /auth/me` → `{ role, permissions: string[] }` (vd `["employee.read","order.create"]`).

**Nguyên tắc**
- **Server là nguồn quyết định**; UI chỉ **ẩn/hiện/disable** cho đúng trải nghiệm — **không** tin UI thay cho kiểm tra backend (backend luôn enforce — ADR-004).
- Lưu `permissions` vào store phía client sau đăng nhập; cung cấp helper `hasPermission('employee.create')`.

**Convention render theo quyền**
| Trường hợp | Cách xử lý |
|---|---|
| Hành động không được phép | **Ẩn** nút/menu (mặc định) |
| Hành động thấy nhưng chưa đủ điều kiện | **Disable** + tooltip lý do (dùng khi việc ẩn gây khó hiểu) |
| Cả trang/route bị chặn | Middleware/guard → redirect hoặc trang "Không có quyền" |
| Menu/sidebar item | Lọc theo permission trước khi render |
| Cột/hành động trong Table | Ẩn cột hành động nếu không có bất kỳ quyền ghi |

**Mẫu khai báo (spec, không code):** component bao `Can` nhận `permission="resource.action"` → render children nếu đủ quyền, ngược lại render `fallback` (mặc định `null`). Route bảo vệ khai báo permission yêu cầu ở tầng layout/segment.

**Lưu ý:** quyền hiển thị ≠ quyền dữ liệu; luôn kèm kiểm tra tenant (`organizationId` từ token) ở API. UI không tự suy diễn quyền ngoài danh sách `permissions` trả về.

---

## 24. Form Convention

Stack: **React Hook Form + Zod** (`@hookform/resolvers`) — CLAUDE.md Mục 13 (validation bắt buộc).

**Cấu trúc & quy ước**
- **Schema Zod** cho mỗi form (đặt tại `features/<feature>/schemas`), là nguồn kiểu + validate; suy ra type qua `z.infer`.
- **Đồng bộ luật với Backend:** rule client phải khớp DTO backend (vd password ≥ 8, có chữ + số — auth.md). Client validate để UX; backend vẫn là nguồn cuối.
- **Field anatomy:** Label (+ `*` nếu required) → Control → Helper (`text-xs muted`) → Error (`text-sm text-destructive`).
- **Thời điểm validate:** `onBlur`/`onTouched` cho field; validate lại toàn form khi submit. Không "quát" lỗi khi user chưa chạm field.
- **Trạng thái submit:** nút primary chuyển **loading + disabled**; khoá double-submit; giữ dữ liệu đã nhập.
- **Thành công:** Toast success + điều hướng/đóng dialog + reset khi phù hợp.
- **Thất bại (server):** map `errors[]` vào đúng field (xem §25); lỗi chung → Toast/alert đầu form.
- **A11y:** `label htmlFor`, `aria-invalid`, `aria-describedby`; focus vào field lỗi đầu tiên khi submit fail.
- **Nội dung:** message tiếng Việt, ngắn, hướng dẫn sửa (vd "Email không hợp lệ").
- **Điều hướng khi có thay đổi chưa lưu:** cảnh báo trước khi rời trang/đóng dialog.

**Chuẩn hoá thông điệp:** tập trung message Zod (một nơi) để đồng nhất giọng văn, tránh lặp.

---

## 25. API Error Convention

Bám **CLAUDE.md Mục 12/14** + **ADR-022** (envelope + `errors[]`). Type đã có tại `types/api.ts`; helper tại `utils/http.ts`.

**Envelope lỗi**
```
{ success:false, code, message, errors?:[{field,message}], data:null, timestamp }
```

**Bản đồ xử lý theo HTTP status → UX (chuẩn toàn app):**

| HTTP | code (ví dụ) | Xử lý UI |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Map `errors[]` vào **từng field** (inline); nếu không map được → alert đầu form |
| 401 | `AUTH_TOKEN_INVALID` / `AUTH_INVALID_CREDENTIALS` | Hết phiên → điều hướng Login (giữ `returnUrl`); nếu ở form login → lỗi chung trung tính |
| 403 | `AUTH_FORBIDDEN` / `AUTH_ACCOUNT_DISABLED` | Toast/alert "Không có quyền" hoặc trang chặn; không lặp lại request |
| 404 | — | Trang/khối Not Found (§19) hoặc thông báo "không tồn tại" |
| 409 | `AUTH_EMAIL_EXISTS` / `RESOURCE_CONFLICT` | Lỗi **inline** ở field liên quan (email) hoặc alert |
| 422 | (nếu có) | như 400 |
| 429 | `RATE_LIMITED` | Toast "Thao tác quá nhanh, thử lại sau"; tạm khoá nút |
| 5xx | `INTERNAL_ERROR` | Toast lỗi + retry; nếu vỡ cả trang → trang 500 (§20) |
| Network/timeout | — | Toast "Mất kết nối, kiểm tra mạng"; nút thử lại |

**Nguyên tắc**
- **Field errors → inline** (không dùng Toast). **Lỗi hệ thống/thao tác → Toast**. Không trộn lẫn.
- Hiển thị `message` từ server (đã thân thiện); chỉ fallback text mặc định khi thiếu (`getApiErrorMessage`).
- **Không** lộ chi tiết kỹ thuật/stack cho người dùng.
- Chuẩn hoá xử lý ở **interceptor Axios** + lớp helper để mọi màn hình nhất quán (401 → logout/redirect tập trung; refresh token do tầng Auth xử lý sau).
- Chống enumeration: tôn trọng thông báo trung tính của backend (login/forgot) — không tự "đoán" và tiết lộ thêm.

---

## 26. Accessibility

- **Focus visible:** luôn có `focus-visible:ring-2 ring-ring ring-offset-2`; không xoá outline mà không thay thế.
- **Keyboard:** mọi hành động thao tác được bằng bàn phím; thứ tự `tab` hợp lý; `Esc` đóng overlay; focus trap trong Dialog.
- **Contrast:** đạt **WCAG AA** ở cả light/dark.
- **Semantics/ARIA:** dùng thẻ ngữ nghĩa; `aria-label` cho icon-button; `aria-live` cho toast/thông báo động; `aria-invalid`/`aria-describedby` cho field lỗi.
- **Không chỉ dựa vào màu:** trạng thái kèm icon/label.
- **Reduced motion:** tôn trọng `prefers-reduced-motion` (giảm pulse/animation).
- **Ngôn ngữ:** `<html lang="vi">` (đã đặt).

---

## Phụ lục — Checklist khi thêm component/màn hình mới

- [ ] Dùng **token ngữ nghĩa**, không hardcode màu.
- [ ] Có đủ **states**: default / hover / focus / disabled / loading / error / empty.
- [ ] **Responsive** theo pattern §21; kiểm ở mobile.
- [ ] **Dark mode** đúng (chỉ dùng token).
- [ ] **Permission** đã gate đúng (§23).
- [ ] **Form** theo §24; **API error** theo §25.
- [ ] **A11y**: label, focus, keyboard, contrast, aria.
- [ ] Không lỗi TypeScript/ESLint (CLAUDE.md Mục 20).

*Hết tài liệu — Design System là chuẩn bắt buộc; cập nhật token ở `styles/globals.css` + `tailwind.config.ts`, không sửa rải rác.*
