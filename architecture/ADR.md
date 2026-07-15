# ADR - Architecture Decision Records

Project: NCMedia Management Platform

Version: 1.0

Status: ACCEPTED

Last Update: 2026-07-14

---

# ADR-001

## Title

Project Positioning

## Status

ACCEPTED

## Decision

Tên chính thức của hệ thống là:

NCMedia Management Platform

Đây KHÔNG phải hệ thống HR thuần túy.

Đây là hệ thống quản lý vận hành doanh nghiệp thương mại điện tử đa nền tảng.

HR chỉ là một module trong hệ thống.

## Reason

Trong tương lai hệ thống sẽ mở rộng:

- TikTok Shop
- eBay
- Amazon
- Etsy
- Shopify
- Walmart

---

# ADR-002

## Title

Architecture Style

## Status

ACCEPTED

## Decision

Architecture:

- Modular Monolith
- Multi Tenant
- REST API
- Clean Architecture (Pragmatic)
- Domain Driven Design Inspired

Không sử dụng Microservice trong MVP.

## Reason

Đơn giản.

Chi phí thấp.

Dễ maintain.

Có thể tách service sau.

---

# ADR-003

## Title

Multi Tenant Strategy

## Status

ACCEPTED

## Decision

Một Organization là một Tenant.

Toàn bộ dữ liệu nghiệp vụ đều thuộc Organization.

Tất cả bảng nghiệp vụ phải có:

organization_id

Ngoại lệ:

- Platform
- Country
- Currency

là bảng Global.

## Reason

Đảm bảo cô lập dữ liệu.

Đơn giản khi query.

---

# ADR-004

## Title

Tenant Enforcement

## Status

ACCEPTED

## Decision

Không sử dụng PostgreSQL Row Level Security.

Tenant được kiểm soát tại tầng Backend.

Mọi Repository phải nhận organizationId.

Không được query khi thiếu organizationId.

## Reason

Đơn giản hơn.

Dễ debug.

Dễ maintain.

---

# ADR-005

## Title

Primary Key Strategy

## Status

ACCEPTED

## Decision

Toàn bộ Primary Key sử dụng UUID.

Không sử dụng Auto Increment.

## Reason

An toàn hơn.

Hỗ trợ scale.

Không lộ số lượng dữ liệu.

---

# ADR-006

## Title

Authentication Model

## Status

ACCEPTED

## Decision

Authentication sử dụng:

- JWT Access Token
- JWT Refresh Token

Access Token:

15 phút.

Refresh Token:

7 ngày.

**Refresh Token — Source of Truth là Database** (bảng `refresh_tokens`).

Redis **chỉ là Cache** (tra cứu nhanh), không phải nguồn chính.

Refresh Token lưu dưới dạng **hash HMAC-SHA256** (không plain text).

Rotation + Reuse Detection quản lý qua bảng `refresh_tokens` (`revoked_at`, `replaced_by_id`).

Password sử dụng bcrypt.

## Revision

2026-07-14: Chuyển Refresh Token store từ "Redis" sang "Database là Source of Truth, Redis là Cache". Lý do: cần bền vững, hỗ trợ Reuse Detection và Audit Security. (Nguồn: Product Owner)

---

# ADR-007

## Title

User Model

## Status

ACCEPTED

## Decision

User và Employee là hai Entity riêng biệt.

Quan hệ:

Organization

↓

User

↓

Employee

User chịu trách nhiệm:

- Login
- Authentication
- Authorization

Employee chịu trách nhiệm:

- Business Information
- Salary
- Birthday
- Avatar

## Reason

Cho phép mở rộng:

Owner

Viewer

Support

Accountant

không cần Employee.

---

# ADR-008

## Title

Organization Membership

## Status

ACCEPTED

## Decision

Một User chỉ thuộc một Organization.

Không hỗ trợ Multi Organization User trong MVP.

## Reason

Requirement hiện tại chưa cần.

Có thể mở rộng sau.

---

# ADR-009

## Title

Role Strategy

## Status

ACCEPTED

## Decision

Role là Dynamic.

Default:

- Admin
- Employee
- Fulfillment

Admin có thể tạo thêm Role.

## Reason

Linh hoạt.

Không hardcode.

---

# ADR-010

## Title

Permission Strategy

## Status

ACCEPTED

## Decision

Permission theo Resource.

Ví dụ:

employee.read

employee.create

employee.update

employee.delete

order.read

order.create

order.update

order.delete

...

Permission gán cho Role.

Không gán trực tiếp cho User.

---

# ADR-011

## Title

Platform Strategy

## Status

ACCEPTED

## Decision

Platform là Global Data.

Default:

TikTok Shop

eBay

Amazon

Etsy

Shopify

Platform không có organization_id.

ShopAccount mới thuộc Organization.

---

# ADR-012

## Title

Order Strategy

## Status

ACCEPTED

## Decision

Sprint đầu.

Order được nhập thủ công.

Đồng bộ API Platform sẽ phát triển sau.

---

# ADR-013

## Title

Fulfillment Strategy

## Status

ACCEPTED

## Decision

Fulfillment KHÔNG là Entity riêng.

Fulfillment là User có Role:

Fulfillment.

Order chỉ lưu:

fulfillment_user_id

---

# ADR-014

## Title

Profit Strategy

## Status

ACCEPTED

## Decision

Order lưu:

Revenue

Cost

Shipping Fee

Platform Fee

Other Fee

Profit không lưu Database.

Profit tính runtime.

---

# ADR-015

## Title

Database Convention

## Status

ACCEPTED

## Decision

Toàn bộ bảng nghiệp vụ có:

id

created_at

updated_at

deleted_at

created_by

updated_by

organization_id

Sử dụng Soft Delete.

---

# ADR-016

## Title

Coding Convention

## Status

ACCEPTED

## Decision

Không Hardcode.

Không Duplicate.

Không Business Logic trong Controller.

Repository Pattern.

DTO bắt buộc.

Validation bắt buộc.

Swagger bắt buộc.

---

# ADR-017

## Title

Frontend

## Status

ACCEPTED

## Decision

Frontend:

Next.js

TypeScript

App Router

TailwindCSS

shadcn/ui

TanStack Query

React Hook Form

Zod

---

# ADR-018

## Title

Backend

## Status

ACCEPTED

## Decision

Backend:

NestJS

Prisma

PostgreSQL

Redis

JWT

Swagger

---

# ADR-019

## Title

Development Workflow

## Status

ACCEPTED

## Decision

Mỗi module phải thực hiện:

Requirement

↓

Business Rule

↓

Database

↓

API

↓

Backend

↓

Frontend

↓

Review

↓

Merge

Không được bỏ qua Review.

---

# ADR-020

## Title

AI Development Rules

## Status

ACCEPTED

## Decision

Claude Code phải:

- Đọc CLAUDE.md trước.
- Đọc ADR.md trước.
- Không tự thay đổi kiến trúc.
- Không tự thêm module.
- Không tự thay đổi Database.
- Không tự thay đổi API.
- Nếu requirement thiếu, phải hỏi trước khi implement.
- Chỉ implement đúng phạm vi Sprint hiện tại.

---

# ADR-021

## Title

JWT Signing Algorithm

## Status

ACCEPTED

## Decision

JWT (Access Token & Refresh Token) ký bằng **HS256**.

Secret lưu ở biến môi trường / secret manager.

Không hardcode secret.

Access Token payload gồm: sub, organizationId, role, jti, iat, exp.

## Reason

Đơn giản cho MVP Modular Monolith (một service ký & verify).

Có thể chuyển sang RS256 khi tách service.

Nguồn: Product Owner (Auth Decision-009).

---

# ADR-022

## Title

API Error Response — errors[]

## Status

ACCEPTED

## Decision

Response chuẩn (CLAUDE.md Mục 12) được bổ sung trường `errors[]` cho lỗi validate từng field.

Cấu trúc mỗi phần tử: { field, message }.

Áp dụng cho toàn hệ thống, không riêng module Auth.

## Reason

Frontend (React Hook Form + Zod) cần hiển thị lỗi theo từng field.

Đảm bảo response thống nhất.

Nguồn: Product Owner (Auth Decision-013).

> Lưu ý: CLAUDE.md Mục 12 cần được cập nhật cho khớp khi có yêu cầu chỉnh Source of Truth.

---

# ADR-023

## Title

API Pagination Convention

## Status

ACCEPTED

## Decision

Phân trang dùng **page/limit**.

Query: ?page=1&limit=20.

Response meta: { total, page, limit, totalPages }.

Áp dụng cho mọi endpoint dạng list.

## Reason

Đơn giản, quen thuộc, đủ cho MVP.

Có thể bổ sung cursor-based cho bảng lớn (Order/Report) về sau.

Nguồn: Product Owner (Auth Decision-014).

---

# ADR-024

## Title

Audit & PII Logging (MVP)

## Status

ACCEPTED

## Decision

Sprint 1: chỉ **mask PII** trong log ứng dụng (không log email ở mức info).

Chưa triển khai Audit Module đầy đủ trong Sprint 1.

Audit Module (ghi vết hành động) để sprint sau.

## Reason

Giảm phạm vi MVP.

Vẫn đảm bảo an toàn dữ liệu cá nhân cơ bản.

Nguồn: Product Owner (Auth Decision-018).