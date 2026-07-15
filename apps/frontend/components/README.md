# components/

Component **dùng chung, không gắn nghiệp vụ**.

- `ui/` — primitive theo chuẩn shadcn/ui (Button, Input, Dialog...). Thêm bằng shadcn CLI hoặc tạo thủ công theo cùng convention.
- Component layout dùng chung (Header, Sidebar...) đặt trực tiếp trong `components/`.

Component gắn với một tính năng cụ thể → đặt trong `features/<feature>/components/`.
