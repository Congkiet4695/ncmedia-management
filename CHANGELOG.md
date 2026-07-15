# CHANGELOG

Toàn bộ thay đổi tài liệu kiến trúc được ghi tại đây.
Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/).

---

## [2026-07-14] — Đồng bộ tài liệu theo ADR (ADR-001 → ADR-020)

### Bối cảnh
Cập nhật `.claude/CLAUDE.md` và `.claude/REVIEW.md` theo toàn bộ 20 quyết định
trong `architecture/ADR.md` (trạng thái ACCEPTED). ADR là ủy quyền của Product Owner
để chỉnh sửa CLAUDE.md.

Phạm vi: **chỉ cập nhật tài liệu kiến trúc**. Không viết code, không tạo module,
không tạo database.

### Changed — `.claude/CLAUDE.md`
- **Header & Mục 1 (ADR-001, ADR-002):** Đổi tên sản phẩm từ "CN/HR Management SaaS"
  → **"NCMedia Management Platform"**. Architecture Style: "Clean Architecture"
  → **"Clean Architecture (Pragmatic)"**; bổ sung "Không dùng Microservice trong MVP".
- **Mục 2 — Project Overview (ADR-001):** Làm rõ đây KHÔNG phải hệ HR thuần túy mà là
  hệ quản lý vận hành TMĐT đa nền tảng; HR chỉ là một module.
- **Mục 4 — User Roles (ADR-007, 009, 013):** Bổ sung Role là Dynamic (Admin tạo thêm được),
  Role mặc định (Admin/Employee/Fulfillment), và ghi chú Fulfillment không phải entity riêng.
- **Mục 5 — Multi Tenant (ADR-003, 004, 008):** Sửa "không có ngoại lệ" → khai báo bảng
  Global (Platform, Country, Currency) không mang `organization_id`; bổ sung cơ chế
  Tenant Enforcement (không RLS, enforce tầng Backend, Repository bắt buộc nhận `organizationId`);
  bổ sung quy tắc User single-org trong MVP.
- **Mục 10 — Authentication (ADR-006):** Bổ sung thời hạn token (Access 15 phút, Refresh 7 ngày).
- **Mục 11 — Database Rules (ADR-005, 015):** Làm rõ bảng Global không có `organization_id`;
  ghi rõ dùng Soft Delete.
- **Mục 17 — Development Workflow (ADR-019):** Cập nhật thứ tự thành
  Requirement → Business Rule → Database → API → Backend (kèm Unit Test) → Frontend → Review → Merge.
- **Mục 18 — AI Development Rules (ADR-020):** Bổ sung "đọc ADR.md trước", "không tự thêm Module",
  "không tự thay đổi Database", "không tự thay đổi API", "hỏi khi requirement thiếu".

### Added — `.claude/CLAUDE.md`
- **Ghi chú đồng bộ ADR** ở phần mở đầu (ADR là nguồn quyết định kiến trúc).
- **Mục 21 — Domain & Data Model Decisions:** Tổng hợp quyết định về User/Employee (ADR-007),
  Role (ADR-009), Permission (ADR-010), Platform (ADR-011), Order (ADR-012),
  Fulfillment (ADR-013), Profit (ADR-014).
- **Mục 22 — ADR Traceability:** Bảng ánh xạ ADR-001 → ADR-020 tới vị trí tương ứng trong CLAUDE.md.

### Changed — `.claude/REVIEW.md`
- Thêm banner "Cập nhật sau ADR" cùng bộ nhãn trạng thái (✅ đã xử lý / 🟡 một phần /
  ⚪ không áp dụng / 🔴 còn mở).
- Gắn nhãn trạng thái **inline** cho từng phát hiện (Mục 1 → 8) kèm căn cứ ADR:
  - ✅ Đã xử lý: 1.1, 2.3, 4.1, 4.3 (và các câu hỏi RBAC, mâu thuẫn Platform).
  - 🟡 Một phần: 1.2, 2.1, 3, 4.2, 6.x, 7.1, 7.2.
  - ⚪ Không áp dụng: Membership (ADR-008), Fulfillment entity riêng (ADR-013).
  - 🔴 Còn mở: 1.3, 1.4, 2.2, 2.4, 2.5, 5.x, 7.3.
- Thêm **Mục 10 — Bảng tổng hợp Disposition**: 4 mục đã xử lý, 9 mục một phần, 8 mục còn mở;
  nêu rõ ưu tiên trước Sprint 1 (API Auth, password policy/bootstrap Admin, tài liệu module Auth)
  và rủi ro bảo mật cần ADR bổ sung (credential Platform, secrets management).

### Added
- `CHANGELOG.md` (tài liệu này).

### Không thay đổi
- `architecture/ADR.md` — giữ nguyên (nguồn quyết định).
- Không tạo/không sửa source code, module, migration hay database.

### Vấn đề còn mở (cần Product Owner quyết định)
1. Đặc tả API Sprint 1 + quy ước chung (pagination, `errors[]`, request-id) — `api.md` module Auth.
2. Business rule Auth: password policy, khóa tài khoản, email uniqueness, bootstrap Admin đầu tiên.
3. Bảo mật cần ADR bổ sung: mã hóa credential Platform, secrets management, PII/audit, ngưỡng rate-limit login.
4. Ranh giới module (module boundaries) cho Modular Monolith.
5. NFR & Observability (hiệu năng, backup/RTO-RPO, timezone/đa tiền tệ, test coverage).
