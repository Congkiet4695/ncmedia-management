# CLAUDE.md

# NCMedia Management Platform - AI Development Guide

> Đây là tài liệu gốc (Source of Truth) dành cho Claude Code.
>
> Mọi quyết định về kiến trúc, coding convention và business logic phải tuân thủ tài liệu này.
>
> Không được tự ý thay đổi nếu chưa có yêu cầu từ Product Owner.
>
> **Đồng bộ ADR:** Tài liệu này đã được cập nhật theo các quyết định trong `architecture/ADR.md` (ADR-001 → ADR-020, trạng thái ACCEPTED, cập nhật 2026-07-14). Khi có mâu thuẫn giữa CLAUDE.md và ADR.md, ADR.md là nguồn quyết định kiến trúc; CLAUDE.md phải được cập nhật cho khớp. Xem bảng truy vết tại Mục 21.

---

# 1. Project Information

## Project Name

NCMedia Management Platform

## Version

0.1.0

## Development Stage

Sprint 1

## Architecture Style

(Theo ADR-002)

* Multi Tenant
* Modular Monolith
* REST API
* Clean Architecture (Pragmatic)
* Domain Driven Design (DDD Inspired)

Không sử dụng Microservice trong MVP. Có thể tách service sau.

---

# 2. Project Overview

(Theo ADR-001)

Đây **KHÔNG** phải hệ thống HR thuần túy.

Đây là hệ thống **quản lý vận hành doanh nghiệp thương mại điện tử đa nền tảng** (NCMedia Management Platform). Quản lý nhân sự (HR) chỉ là **một module** trong hệ thống.

Mỗi tổ chức có dữ liệu độc lập.

Mỗi tổ chức có:

* Nhân viên
* Shop Account
* Đơn hàng
* Dashboard
* Báo cáo

Hệ thống phải hỗ trợ mở rộng sang:

* TikTok Shop
* eBay
* Amazon
* Etsy
* Shopify
* Walmart

Không giới hạn số lượng nền tảng.

---

# 3. Product Goal

Mục tiêu của hệ thống:

* Quản lý nhân viên.
* Quản lý Shop Account.
* Quản lý Order.
* Quản lý Fulfillment.
* Thống kê doanh thu.
* Thống kê lợi nhuận.
* Báo cáo theo nhân viên.
* Báo cáo theo nền tảng.
* Báo cáo theo Shop.

---

# 4. User Roles

(Theo ADR-007, ADR-009, ADR-013)

Role là **Dynamic**: Admin có thể tạo thêm Role ngoài các Role mặc định. Không hardcode Role.

Role mặc định (default) khi seed:

* Admin
* Employee
* Fulfillment

**Fulfillment không phải Entity riêng** — Fulfillment là một User mang Role `Fulfillment` (xem ADR-013 và Mục 21).

Quyền của từng Role bên dưới là quyền mặc định; quyền thực tế được điều khiển qua Permission gán cho Role (xem Mục 21 và ADR-010).

## Admin

Có toàn quyền trong Organization.

Chức năng:

* Quản lý Organization
* Quản lý Employee
* Quản lý Permission
* Quản lý Platform
* Quản lý Dashboard
* Quản lý Report
* Quản lý Shop
* Quản lý Order

---

## Employee

Có thể:

* Đăng nhập
* Cập nhật Profile
* Quản lý Shop Account của mình
* Quản lý Order của mình
* Xem Dashboard cá nhân

---

## Fulfillment

Có thể:

* Được gán xử lý Order
* Cập nhật trạng thái Fulfillment
* Không được quản trị hệ thống

---

# 5. Multi Tenant

(Theo ADR-003, ADR-004, ADR-008)

Đây là yêu cầu bắt buộc.

Mỗi Organization là một Tenant.

Không được phép truy cập dữ liệu của Organization khác.

Mọi bảng **nghiệp vụ** phải có:

* organization_id

## Ngoại lệ — Bảng Global (không có organization_id)

Các bảng danh mục dùng chung toàn hệ thống là **Global Data**, KHÔNG mang `organization_id`:

* Platform
* Country
* Currency

## Cơ chế thực thi Tenant (Tenant Enforcement)

* **KHÔNG** sử dụng PostgreSQL Row Level Security (RLS).
* Tenant được kiểm soát tại **tầng Backend**.
* Mọi Repository **phải nhận `organizationId`**.
* **Không được query khi thiếu `organizationId`** (với bảng nghiệp vụ).

## Phạm vi Organization của User

* Một User chỉ thuộc **một** Organization.
* Không hỗ trợ Multi Organization User trong MVP (có thể mở rộng sau).

---

# 6. Core Modules

Sprint sẽ được triển khai theo thứ tự sau:

1. Authentication
2. Organization
3. Role
4. Permission
5. Platform
6. Employee
7. Shop Account
8. Order
9. Dashboard
10. Report
11. Notification
12. Setting

Không triển khai module tiếp theo khi module hiện tại chưa được review.

---

# 7. Technology Stack

## Frontend

* Next.js 15
* TypeScript
* App Router
* TailwindCSS
* shadcn/ui
* React Hook Form
* TanStack Query
* Zod

---

## Backend

* NestJS
* TypeScript
* Prisma ORM
* PostgreSQL
* Redis
* JWT
* Swagger

---

## Infrastructure

* Docker
* Docker Compose
* Ubuntu 24.04
* Nginx

---

# 8. Coding Principles

Bắt buộc tuân thủ:

* SOLID
* DRY
* KISS
* Clean Code
* Clean Architecture

Không được:

* Hardcode
* Duplicate Code
* Tạo Business Logic trong Controller
* Bỏ qua Validation
* Bỏ qua Error Handling

---

# 9. Folder Structure

## Backend

```
src/

modules/

common/

config/

database/

shared/
```

Mỗi module:

```
controller

service

repository

dto

entity

mapper

validator

exception

types

interfaces
```

---

## Frontend

```
app/

components/

hooks/

services/

stores/

types/

utils/

styles/
```

---

# 10. Authentication

(Theo ADR-006)

Sử dụng:

* JWT Access Token — thời hạn **15 phút**.
* JWT Refresh Token — thời hạn **7 ngày**.

Refresh Token lưu Redis.

Password mã hóa bằng bcrypt.

---

# 11. Database Rules

(Theo ADR-005, ADR-015)

Sử dụng PostgreSQL.

Mọi bảng **nghiệp vụ** phải có:

* id
* created_at
* updated_at
* deleted_at
* created_by
* updated_by
* organization_id

Bảng **Global** (Platform, Country, Currency — xem Mục 5) KHÔNG có `organization_id`.

Sử dụng **Soft Delete** (`deleted_at`).

Sử dụng UUID làm Primary Key.

Không sử dụng Auto Increment.

---

# 12. API Rules

RESTful API.

Version:

```
/api/v1
```

Response chuẩn:

```json
{
  "success": true,
  "code": "SUCCESS",
  "message": "",
  "data": {},
  "timestamp": ""
}
```

Không trả về Response không thống nhất.

---

# 13. Validation Rules

Mọi Request đều phải:

* Validate
* DTO
* Swagger
* Error Response

Không được bỏ qua Validation.

---

# 14. Error Handling

Không throw Exception trực tiếp.

Sử dụng Exception chuẩn của NestJS.

Mọi Error phải có:

* Code
* Message
* HTTP Status

---

# 15. Security

Bắt buộc:

* JWT
* Helmet
* CORS
* Rate Limit
* Password Hash
* Input Validation

Không lưu Password dạng Plain Text.

---

# 16. Documentation Rules

Mỗi module đều phải có:

```
docs/

requirements.md

business-rules.md

database.md

api.md
```

Claude Code phải đọc tài liệu module trước khi implement.

---

# 17. Development Workflow

(Theo ADR-019)

Mỗi module phải thực hiện theo thứ tự:

1. Requirement (đọc tài liệu).
2. Business Rule.
3. Database.
4. API.
5. Backend (bao gồm Unit Test).
6. Frontend.
7. Review.
8. Merge.

Không được bỏ qua bước Review.

---

# 18. AI Development Rules

(Theo ADR-020)

Claude Code phải tuân thủ:

* Đọc `CLAUDE.md` trước.
* Đọc `architecture/ADR.md` trước.
* Không tự ý thay đổi Architecture.
* Không tự ý thêm Module.
* Không tự ý thay đổi Database.
* Không tự ý thay đổi API.
* Không tự ý thêm chức năng ngoài Requirement.
* Không generate code demo.
* Không generate fake data.
* Không hardcode dữ liệu.
* Không bỏ qua Validation.
* Nếu Requirement thiếu hoặc mâu thuẫn, phải hỏi trước khi implement.
* Chỉ triển khai đúng phạm vi Sprint hiện tại.

---

# 19. Current Sprint

Sprint hiện tại:

Sprint 1

Scope:

* Register Organization
* Login
* Refresh Token
* Logout
* Seed dữ liệu mặc định
* Tạo Admin đầu tiên
* RBAC Foundation

Không triển khai Employee, Order hoặc Dashboard trong Sprint 1.

---

# 20. Definition of Done

Một module được xem là hoàn thành khi đáp ứng tất cả:

* Đúng Requirement.
* Đúng Business Rules.
* Database Migration hoàn chỉnh.
* API đầy đủ.
* Swagger đầy đủ.
* Validation đầy đủ.
* Error Handling đầy đủ.
* Frontend hoạt động.
* Không có lỗi TypeScript.
* Không còn TODO hoặc FIXME.
* Được review và chấp thuận trước khi chuyển sang Sprint tiếp theo.

---

# 21. Domain & Data Model Decisions (ADR Alignment)

> Mục này ghi lại các quyết định về mô hình domain đã được chốt trong `architecture/ADR.md`.
> Đây chỉ là ràng buộc thiết kế (design constraint). **KHÔNG** phải lệnh tạo database/module — việc implement chỉ thực hiện đúng phạm vi Sprint hiện tại (Mục 19).

## 21.1. User & Employee (ADR-007)

* `User` và `Employee` là **hai Entity riêng biệt**.
* Quan hệ: `Organization` → `User` → `Employee`.
* `User` chịu trách nhiệm: Login, Authentication, Authorization.
* `Employee` chịu trách nhiệm: Business Information, Salary, Birthday, Avatar.
* Lý do: cho phép các vai trò như Owner, Viewer, Support, Accountant tồn tại **không cần** hồ sơ Employee.

## 21.2. Role (ADR-009)

* Role là **Dynamic**. Admin có thể tạo thêm Role.
* Role mặc định: Admin, Employee, Fulfillment.

## 21.3. Permission (ADR-010)

* Permission theo **Resource**, dạng `resource.action`.
* Ví dụ: `employee.read`, `employee.create`, `employee.update`, `employee.delete`, `order.read`, `order.create`, `order.update`, `order.delete`, ...
* Permission **gán cho Role**. **Không** gán trực tiếp cho User.

## 21.4. Platform (ADR-011)

* `Platform` là **Global Data**, KHÔNG có `organization_id`.
* Platform mặc định: TikTok Shop, eBay, Amazon, Etsy, Shopify.
* `ShopAccount` mới là entity thuộc Organization (tenant-scoped).

## 21.5. Order (ADR-012)

* Sprint đầu: Order được **nhập thủ công**.
* Đồng bộ API Platform sẽ phát triển sau.

## 21.6. Fulfillment (ADR-013)

* Fulfillment **KHÔNG** là Entity riêng.
* Fulfillment là một `User` mang Role `Fulfillment`.
* `Order` chỉ lưu `fulfillment_user_id`.

## 21.7. Profit (ADR-014)

* `Order` lưu: Revenue, Cost, Shipping Fee, Platform Fee, Other Fee.
* **Profit KHÔNG lưu Database** — Profit được tính **runtime**.

---

# 22. ADR Traceability

Bảng ánh xạ quyết định ADR → vị trí trong CLAUDE.md.

| ADR | Tiêu đề | Phản ánh tại |
|---|---|---|
| ADR-001 | Project Positioning | Mục 1 (Project Name), Mục 2 (Overview) |
| ADR-002 | Architecture Style | Mục 1 (Architecture Style) |
| ADR-003 | Multi Tenant Strategy | Mục 5 (Ngoại lệ bảng Global), Mục 11 |
| ADR-004 | Tenant Enforcement | Mục 5 (Tenant Enforcement) |
| ADR-005 | Primary Key Strategy | Mục 11 |
| ADR-006 | Authentication Model | Mục 10 |
| ADR-007 | User Model | Mục 21.1 |
| ADR-008 | Organization Membership | Mục 5 (Phạm vi Organization của User) |
| ADR-009 | Role Strategy | Mục 4, Mục 21.2 |
| ADR-010 | Permission Strategy | Mục 21.3 |
| ADR-011 | Platform Strategy | Mục 5, Mục 21.4 |
| ADR-012 | Order Strategy | Mục 21.5 |
| ADR-013 | Fulfillment Strategy | Mục 4, Mục 21.6 |
| ADR-014 | Profit Strategy | Mục 21.7 |
| ADR-015 | Database Convention | Mục 11 |
| ADR-016 | Coding Convention | Mục 8, Mục 13 |
| ADR-017 | Frontend | Mục 7 (Frontend) |
| ADR-018 | Backend | Mục 7 (Backend) |
| ADR-019 | Development Workflow | Mục 17 |
| ADR-020 | AI Development Rules | Mục 18 |

---

## Database Development Rule

Bất kỳ thay đổi nào liên quan đến:

- schema.prisma
- migration
- seed

Claude phải:

1. prisma generate
2. prisma migrate dev
3. prisma db seed
4. Verify database bằng Prisma Studio hoặc truy vấn thực tế
5. Chỉ kết thúc khi database local đã đồng bộ với schema.