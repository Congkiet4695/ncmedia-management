# Biến môi trường khi triển khai

> Áp dụng cho stack production `deploy/docker-compose.production.yml`.
> Nguyên tắc: **`deploy/.env.production` là nguồn duy nhất.** Thêm biến mới KHÔNG cần
> sửa `docker-compose.production.yml`.

---

## 1. Quy trình thêm một biến môi trường mới

Ví dụ thêm khoá OpenAI:

```bash
# 1. Thêm vào deploy/.env.production (và deploy/.env.production.example để đồng đội biết)
echo 'OPENAI_API_KEY=sk-...' >> deploy/.env.production

# 2. (Nếu cần) thêm luật vào apps/backend/src/config/env.validation.ts
#    OPENAI_API_KEY: Joi.string().required(),

# 3. Deploy
bash deploy/deploy.sh
```

**Hết.** Không đụng tới `docker-compose.production.yml`.

Bước 2 là **tuỳ chọn**: `ConfigModule` của Nest chạy Joi với `allowUnknown: true`, nên biến chưa
khai báo vẫn vào được `process.env` và ứng dụng vẫn khởi động. Khai báo Joi là để **hỏng sớm và
hỏng rõ** khi thiếu/sai định dạng, không phải để biến được nhận.

---

## 2. Kiến trúc — hai đường đi khác nhau của cùng một file

`deploy/.env.production` được Docker Compose dùng theo **hai** cách, rất dễ nhầm:

| Cơ chế | Khai báo ở đâu | Tác dụng |
|---|---|---|
| `--env-file .env.production` | `deploy.sh` (biến `$COMPOSE`) | Nội suy `${...}` **bên trong file YAML**. KHÔNG tự động vào container. |
| `env_file:` | từng service trong compose | Nạp **toàn bộ** biến **vào container**. |

Trước refactor chỉ có cơ chế (1), nên mỗi biến muốn tới được backend đều phải liệt kê lại một
dòng trong `environment:` — đó chính là chỗ phải sửa mỗi lần thêm biến.

Sau refactor, `backend` và `seed` dùng `env_file`, còn `environment:` chỉ giữ đúng hai loại:

**(a) Giá trị Compose tính từ topology mạng Docker** — không thể viết sẵn trong `.env`:

| Biến | Giá trị | Vì sao |
|---|---|---|
| `DATABASE_URL` | ghép từ `POSTGRES_*` + host `postgres` | Trong mạng Docker, host là tên service, khác hoàn toàn giá trị dùng khi chạy máy local |
| `REDIS_HOST` / `REDIS_PORT` | `redis` / `6379` | như trên |

**(b) Giá trị khoá cứng vì hạ tầng phụ thuộc vào nó:**

| Biến | Giá trị | Ràng buộc |
|---|---|---|
| `PORT` | `3000` | `HEALTHCHECK` trong `apps/backend/Dockerfile` + upstream trong `nginx.conf` |
| `API_PREFIX` | `api/v1` | như trên |
| `NODE_ENV` | `production` | nhánh production của ConfigModule / Prisma / pino |
| `SEED_DEMO` (service `seed`) | `false` | `seed.ts` mặc định **bật** (`SEED_DEMO !== 'false'`); thiếu là tạo nhầm admin demo |

**Thứ tự ưu tiên của Compose: `environment` > `env_file` > `ENV` trong image.**
Nhờ vậy, dù `.env.production` có `DATABASE_URL=postgresql://localhost/...` (copy nhầm từ máy dev)
thì container vẫn dùng chuỗi đúng do Compose ghép — không thể tự bắn vào chân.

---

## 3. Vì sao Postgres/Redis/Frontend KHÔNG dùng `env_file`

- **Postgres / Redis:** image chính thức đọc nhiều biến điều khiển khởi tạo
  (`POSTGRES_INITDB_ARGS`, `POSTGRES_HOST_AUTH_METHOD`, …). Nạp cả file `.env` ứng dụng vào đây
  nghĩa là một biến đặt nhầm tên có thể âm thầm đổi cách khởi tạo database. Chúng chỉ cần 4 biến,
  nên liệt kê tường minh là an toàn hơn.
- **Frontend:** Next.js **inline** biến `NEXT_PUBLIC_*` vào bundle **lúc build**. Truyền lúc chạy
  không có tác dụng, nên phải đi qua `build.args`.

---

## 4. Định dạng file `.env.production`

Docker đọc file này bằng bộ phân tích dotenv, **không phải shell**:

- Không có khoảng trắng quanh `=` → `KEY=value`, không phải `KEY = value`.
- Không bọc nháy trừ khi ký tự nháy thuộc về chính giá trị.
- Giá trị chứa `#` phải bọc nháy kép, nếu không phần sau `#` bị coi là chú thích.
- **Phải dùng xuống dòng LF.** File soạn trên Windows (CRLF) làm mọi giá trị thừa ký tự `\r` →
  xác thực DB/Redis/TikTok fail với thông báo rất khó hiểu. `deploy.sh` chặn sẵn trường hợp này;
  sửa bằng `sed -i 's/\r$//' deploy/.env.production`.
- Không nội suy: `A=${B}` cho ra chuỗi `${B}` nguyên văn, không phải giá trị của `B`.

---

## 5. Lưu ý bảo mật

`env_file` nạp **toàn bộ** biến vào container backend, kể cả những biến vốn chỉ dùng để nội suy
(`POSTGRES_PASSWORD`, `DOMAIN`, `NCMEDIA_*`). Đây là đánh đổi có chủ ý và chấp nhận được: backend
vốn đã giữ `DATABASE_URL` chứa đúng mật khẩu đó, nên không mở rộng thêm phạm vi rủi ro.

Cần cô lập chặt hơn thì tách thành hai file (`.env.infra` cho compose, `.env.app` cho `env_file`)
và trỏ `env_file:` vào file thứ hai — cấu trúc hiện tại đã sẵn sàng cho việc đó.

---

## 6. Kiểm chứng

```bash
# Xem cấu hình sau khi Compose đã resolve (không cần chạy container)
cd deploy
docker compose -f docker-compose.production.yml --env-file .env.production config

# Kiểm tra một biến đã vào container thật chưa
docker exec ncmedia-backend printenv | grep TEST_ENV

# Đếm số biến trong container
docker exec ncmedia-backend printenv | wc -l
```

`deploy.sh` tự chạy bước đối chiếu này sau khi healthcheck xong và in cảnh báo nếu có biến trong
`.env.production` mà không thấy trong `process.env` của backend.

---

## 7. Dùng file .env khác (staging / verify)

```bash
ENV_FILE=.env.staging bash deploy/deploy.sh
```

`deploy.sh` **export** `ENV_FILE`, và compose nội suy `${ENV_FILE:-.env.production}` cho khối
`env_file:`. Nhờ vậy nguồn nội suy và file nạp vào container luôn là **một** — không có chuyện
nội suy từ file này nhưng nạp file kia.
