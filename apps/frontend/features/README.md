# features/

Mỗi **feature nghiệp vụ** đặt trong một thư mục con tại đây, đóng gói theo tính năng (feature-based):

```
features/
  <feature>/
    components/   # UI riêng của feature
    hooks/        # hook riêng (thường dùng React Query)
    services/     # gọi API của feature
    schemas/      # Zod schema (validate form)
    types/        # type riêng feature
    index.ts      # public API của feature
```

> ⚠️ **Chưa implement bất kỳ feature nào** ở giai đoạn bootstrap.
> Auth (Login/Register), Dashboard, Employee, Order... sẽ được thêm theo đúng Sprint & workflow ADR-019.
