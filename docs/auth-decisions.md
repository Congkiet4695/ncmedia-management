# Auth Module — Open Decisions Log

> Nguồn: `docs/auth.md` (v1.0, DRAFT).
> Mục đích: liệt kê **toàn bộ** điểm đang ở trạng thái *cần Product Owner quyết định* / *[Giả định]* / *cần ADR* trong tài liệu Auth, để PO chốt trước khi implement (workflow ADR-019).
>
> ⚠️ Tài liệu này **không tự quyết định**. Mỗi mục có phần *Recommendation* (đề xuất kỹ thuật) và *Default Recommendation* (giá trị áp dụng tạm nếu PO chưa phản hồi) — nhưng **quyền quyết định cuối cùng thuộc Product Owner**.
> Không chỉnh sửa `docs/auth.md`. Sau khi PO chốt, mới cập nhật ngược lại `auth.md` sang trạng thái ACCEPTED.
>
> Tổng: **18 quyết định** (12 ưu tiên cho Sprint 1, 6 cho Sprint 2+/toàn hệ thống).

---

## Decision-001

**Question**
Email của User là duy nhất trên toàn hệ thống (global) hay chỉ duy nhất trong từng Organization? (auth.md BR-04, 15.2)

**Options**
- A. Global unique — một email chỉ tồn tại một lần trên toàn platform.
- B. Unique theo org — cùng email có thể xuất hiện ở nhiều org khác nhau.

**Recommendation**
Option A (Global unique).

**Pros**
- Login chỉ cần email + password, không phải chọn Organization.
- Phù hợp ADR-008 (1 User = 1 Org) — không có nhu cầu trùng email.
- Đơn giản index & tránh nhầm lẫn danh tính.

**Cons**
- Một người thật muốn có tài khoản ở 2 org khác nhau sẽ phải dùng 2 email.

**Default Recommendation**
Global unique (Option A).

---

## Decision-002

**Question**
Chính sách độ phức tạp mật khẩu là gì? (auth.md BR-07, Mục 17)

**Options**
- A. Tối thiểu 8 ký tự, có ≥ 1 chữ và ≥ 1 số.
- B. Tối thiểu 12 ký tự, có chữ hoa + chữ thường + số + ký tự đặc biệt.
- C. Theo NIST: ≥ 8 ký tự, chỉ chặn mật khẩu phổ biến/bị lộ, không bắt buộc ký tự đặc biệt.

**Recommendation**
Option C (NIST-style) — cân bằng bảo mật & trải nghiệm.

**Pros**
- Giảm mật khẩu yếu thực chất (chặn danh sách lộ) thay vì ép quy tắc dễ đoán.
- UX tốt, ít reset.

**Cons**
- Cần tích hợp danh sách mật khẩu bị lộ (haveibeenpwned/dictionary).

**Default Recommendation**
Option A (8 ký tự, ≥1 chữ + ≥1 số) — dễ triển khai ngay cho MVP; nâng lên C sau.

---

## Decision-003

**Question**
bcrypt cost factor bằng bao nhiêu? (auth.md BR-06)

**Options**
- A. 10. B. 12. C. 14.

**Recommendation**
Option B (12).

**Pros**
- ~250ms/hash trên phần cứng hiện đại — kháng brute-force tốt, độ trễ chấp nhận được.

**Cons**
- Cao hơn 10 → tốn CPU hơn mỗi lần login/register.

**Default Recommendation**
Cost = 12 (Option B).

---

## Decision-004

**Question**
Chính sách khóa tài khoản khi đăng nhập sai: ngưỡng và thời gian khóa? (auth.md BR-14)

**Options**
- A. 5 lần sai / 15 phút → khóa 15 phút.
- B. 10 lần sai / 15 phút → khóa 30 phút.
- C. Không khóa tài khoản, chỉ rate-limit theo IP + email.

**Recommendation**
Option A, kết hợp rate-limit (Decision-005).

**Pros**
- Chặn brute-force hiệu quả; ngưỡng quen thuộc với người dùng.

**Cons**
- Có thể bị lạm dụng để khóa tài khoản người khác (DoS) nếu chỉ khóa theo email → cần khóa theo (email + IP) và thông báo trung tính.

**Default Recommendation**
5 lần / 15 phút, khóa 15 phút, tính theo (email + IP) (Option A).

---

## Decision-005

**Question**
Ngưỡng rate limit cho các endpoint nhạy cảm (login, forgot-password, refresh)? (auth.md Mục 19, Security)

**Options**
- A. login 5/phút/IP, forgot 3/giờ/IP, refresh 30/phút/IP.
- B. Ngưỡng nới lỏng gấp đôi A.
- C. Chỉ rate-limit global toàn API, không riêng endpoint.

**Recommendation**
Option A (ngưỡng riêng theo endpoint).

**Pros**
- Bảo vệ đúng điểm rủi ro; forgot chặt để tránh spam email.

**Cons**
- Cần cấu hình + store đếm (Redis) riêng cho từng nhóm.

**Default Recommendation**
Option A.

---

## Decision-006

**Question**
Có áp dụng Refresh Token Rotation + phát hiện reuse (thu hồi toàn phiên khi token cũ bị dùng lại) không? (auth.md BR-11, Flow 8)

**Options**
- A. Có rotation + reuse-detection.
- B. Refresh token cố định trong 7 ngày, không rotation.

**Recommendation**
Option A.

**Pros**
- Chuẩn bảo mật hiện đại; phát hiện token bị đánh cắp; giới hạn thời gian sống token thực tế.

**Cons**
- Phức tạp hơn; cần xử lý race condition khi client gọi refresh song song.

**Default Recommendation**
Có rotation + reuse-detection (Option A).

---

## Decision-007

**Question**
Quan hệ User–Role là nhiều-nhiều (một User nhiều Role) hay một-một (mỗi User một Role)? (auth.md BR-19, 15.1)

**Options**
- A. Nhiều-nhiều qua bảng `user_roles`; quyền = union permission các Role.
- B. Một-một: cột `role_id` trên `users`.

**Recommendation**
Option A (n-n).

**Pros**
- Linh hoạt, đúng chuẩn RBAC; hợp với Role Dynamic (ADR-009); dễ mở rộng (VD Admin kiêm Accountant).

**Cons**
- Truy vấn quyền phức tạp hơn một chút (join thêm 1 bảng).

**Default Recommendation**
Nhiều-nhiều qua `user_roles` (Option A).

---

## Decision-008

**Question**
Bảng `permissions` là danh mục **Global** (không có `organization_id`) hay tenant-scoped theo từng org? (auth.md BR-28, 15.1)

**Options**
- A. Global catalog (giống Platform/Country/Currency — ADR-003).
- B. Tenant-scoped: mỗi org có bộ permission riêng.

**Recommendation**
Option A (Global).

**Pros**
- Permission `resource.action` là hằng số hệ thống, không thay đổi theo org; tránh trùng lặp dữ liệu; seed một lần.

**Cons**
- Org không thể tự định nghĩa permission mới (chấp nhận được — permission gắn với code, không phải dữ liệu người dùng).

**Default Recommendation**
Global catalog (Option A). *Cần PO xác nhận vì mục 5 CLAUDE.md từng nói "không ngoại lệ" — ADR-003 đã mở ngoại lệ cho bảng Global.*

---

## Decision-009

**Question**
Thuật toán ký JWT và nơi lưu khóa/secret? (auth.md Security; REVIEW 7.1 — chưa có ADR)

**Options**
- A. RS256 (khóa bất đối xứng), private key ký ở Auth, public key verify phân tán; khóa lưu ở secret manager/ENV.
- B. HS256 (khóa đối xứng dùng chung), secret lưu ENV.

**Recommendation**
Option A (RS256).

**Pros**
- Dễ xoay khóa; các service/module chỉ cần public key để verify; an toàn hơn khi tách service sau (ADR-002).

**Cons**
- Quản lý cặp khóa phức tạp hơn HS256.

**Default Recommendation**
RS256 (Option A); nếu MVP cần đơn giản tối đa → HS256 tạm thời rồi chuyển RS256. **Cần một ADR mới về JWT & Secrets Management.**

---

## Decision-010

**Question**
Xác minh email là **bắt buộc trước khi login** (hard) hay **cho login trước, nhắc verify sau** (soft)? (auth.md BR-13, Flow 13)

**Options**
- A. Hard — chưa verify không được login.
- B. Soft — login được nhưng giới hạn/nhắc nhở tới khi verify.
- C. Không dùng verify email trong MVP.

**Recommendation**
Option B (Soft) cho MVP.

**Pros**
- Onboarding mượt (Admin đầu tiên dùng ngay sau register); vẫn khuyến khích verify.

**Cons**
- Có tài khoản chưa verify tồn tại; cần logic giới hạn quyền tạm.

**Default Recommendation**
Soft (Option B). *Lưu ý: Verify Email là 🟡 S2+, không triển khai trong Sprint 1.*

---

## Decision-011

**Question**
TTL của email verification token? (auth.md 15.4, Flow 13)

**Options**
- A. 24 giờ. B. 48 giờ. C. 7 ngày.

**Recommendation**
Option A (24h) + cho phép resend.

**Pros**
- Cân bằng bảo mật & tiện dụng; kèm resend nên không gây kẹt.

**Cons**
- Link hết hạn nhanh nếu người dùng chậm → phải resend.

**Default Recommendation**
24 giờ (Option A).

---

## Decision-012

**Question**
TTL của reset-password token? (auth.md 15.4, Flow 11/12)

**Options**
- A. 30 phút. B. 1 giờ. C. 24 giờ.

**Recommendation**
Option A (30 phút).

**Pros**
- Cửa sổ tấn công hẹp cho thao tác nhạy cảm (đặt lại mật khẩu).

**Cons**
- Người dùng chậm phải yêu cầu lại link.

**Default Recommendation**
30 phút (Option A).

---

## Decision-013

**Question**
Có bổ sung mảng `errors[]` (lỗi validate từng field) vào error envelope chuẩn toàn hệ thống không? (auth.md Mục 16, 18 — ảnh hưởng CLAUDE.md Mục 12)

**Options**
- A. Bổ sung `errors[]` vào envelope chuẩn (cần cập nhật Mục 12 qua ADR).
- B. Giữ nguyên envelope hiện tại (chỉ `code` + `message`), nhồi chi tiết vào `message`.

**Recommendation**
Option A.

**Pros**
- FE hiển thị lỗi theo từng field (React Hook Form + Zod) chuẩn xác; nhất quán toàn hệ thống.

**Cons**
- Thay đổi hợp đồng response chuẩn → cần ADR + cập nhật mọi module.

**Default Recommendation**
Bổ sung `errors[]` (Option A) — nên chốt sớm vì ảnh hưởng toàn hệ thống. **Cần ADR sửa Mục 12.**

---

## Decision-014

**Question**
Chuẩn phân trang cho các endpoint list (`GET /roles`, `/permissions`, và toàn hệ thống)? (auth.md Mục 16 — chưa có ADR)

**Options**
- A. Page-based: `?page=&limit=`, `meta:{ total, page, limit }`.
- B. Cursor-based: `?cursor=&limit=`, `meta:{ nextCursor }`.

**Recommendation**
Option A (page-based) cho MVP.

**Pros**
- Đơn giản, quen thuộc; đủ cho dữ liệu Auth (roles/permissions nhỏ).

**Cons**
- Kém hiệu quả cho bảng rất lớn (Order sau này) → có thể cần cursor cho một số endpoint.

**Default Recommendation**
Page-based (Option A); cân nhắc cursor riêng cho Order/Report về sau. **Nên chốt qua ADR chung về API convention.**

---

## Decision-015

**Question**
Khi Change Password thành công, có giữ lại phiên hiện tại không hay đăng xuất tất cả? (auth.md Flow 10, BR-08)

**Options**
- A. Thu hồi tất cả refresh token nhưng cấp cặp token mới cho phiên hiện tại (giữ phiên đang thao tác).
- B. Thu hồi tất cả, buộc đăng nhập lại ở mọi thiết bị kể cả phiên hiện tại.

**Recommendation**
Option A.

**Pros**
- Bảo mật (đăng xuất thiết bị khác) nhưng không làm gián đoạn người vừa đổi mật khẩu.

**Cons**
- Phức tạp hơn một chút (phải re-issue token trong cùng request).

**Default Recommendation**
Giữ phiên hiện tại, thu hồi phiên khác (Option A). *Change Password là 🟡 S2+.*

---

## Decision-016

**Question**
`organizations.slug` có bắt buộc và duy nhất không? (auth.md 15.2)

**Options**
- A. Có — `slug` unique, sinh tự động từ tên, dùng cho URL/subdomain sau này.
- B. Không dùng slug trong MVP, chỉ dùng `id` (UUID).

**Recommendation**
Option A.

**Pros**
- Chuẩn bị cho URL thân thiện/subdomain đa tenant; rẻ khi thêm ngay từ đầu.

**Cons**
- Cần xử lý sinh slug & chống trùng.

**Default Recommendation**
Có slug unique (Option A); nếu muốn tối giản MVP thì tạm bỏ (Option B).

---

## Decision-017

**Question**
Trạng thái mặc định của User ngay sau Register là gì? (auth.md Flow 6, BR-13)

**Options**
- A. `ACTIVE` ngay (không chặn login).
- B. `PENDING_VERIFICATION` tới khi verify email.

**Recommendation**
Phụ thuộc Decision-010. Nếu verify = Soft/None → `ACTIVE`; nếu Hard → `PENDING_VERIFICATION`.

**Pros**
- Nhất quán với chính sách verify đã chọn.

**Cons**
- Ràng buộc với Decision-010 (không quyết định độc lập).

**Default Recommendation**
`ACTIVE` (Option A), khớp Default của Decision-010 (Soft verify). *Verify là S2+, nên Sprint 1 mặc định ACTIVE.*

---

## Decision-018

**Question**
Chính sách Audit Log & che (masking) dữ liệu cá nhân (PII) cho sự kiện Auth? (auth.md Security; REVIEW 1.4/7.1 — chưa có ADR)

**Options**
- A. Ghi audit sự kiện đăng nhập/đổi mật khẩu/khóa tài khoản vào module Audit Log; email/PII được mask trong log ứng dụng.
- B. Chưa làm audit trong MVP, chỉ log lỗi hệ thống.

**Recommendation**
Option A về lâu dài; MVP tối thiểu là mask PII trong log.

**Pros**
- Phục vụ điều tra bảo mật & tuân thủ (GDPR/PII).

**Cons**
- Cần module Audit Log riêng (ngoài Sprint 1).

**Default Recommendation**
Sprint 1: mask PII trong log ứng dụng (không log email ở mức info). Audit Log đầy đủ để sprint sau. **Cần ADR riêng cho Audit/Compliance.**

---

## Tổng hợp ưu tiên

| Nhóm | Decisions | Cần chốt trước |
|---|---|---|
| **Sprint 1 (bắt buộc trước khi code Auth)** | 001, 002, 003, 004, 005, 006, 007, 008, 009, 013, 014, 017 | Bắt đầu implement Sprint 1 |
| **Sprint 2+ (flow mở rộng)** | 010, 011, 012, 015 | Trước khi làm Change/Forgot/Reset/Verify |
| **Cần ADR mới (ảnh hưởng toàn hệ thống)** | 008, 009, 013, 014, 018 | Cập nhật `architecture/ADR.md` |
| **Tùy chọn / thấp** | 016 | Có thể hoãn |

> Sau khi Product Owner chọn cho từng Decision, tôi sẽ cập nhật `docs/auth.md` (và tạo ADR mới nếu cần) rồi mới sang bước Database → API → Backend. **Chưa sinh code cho tới khi được duyệt.**
