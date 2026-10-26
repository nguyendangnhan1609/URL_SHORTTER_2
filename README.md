# URL_SHORTENER_2
bản cải tiền từ URL SHORTTER cũ.

## Chạy nhanh
- Docker: `docker compose up --build` (app tại http://localhost:3000).
  - Lưu ý: `docker-compose.yml` dùng mật khẩu DEV (`shortener`/`shortener`) chỉ để phát triển local. KHÔNG dùng cho production; hãy đổi mật khẩu và quản lý secret qua biến môi trường/secret manager.
- Không Docker: `npm i && DATABASE_URL=postgres://user:pass@localhost:5432/db npm start`.
- Xem file mẫu cấu hình `.env.example`.

## Chạy test
`npm test` (dùng pg-mem, không cần Postgres thật).

## Đếm click
Click được ghi theo lô mỗi 1 giây (không ghi từng request). Request `HEAD` và prefetch (header `Purpose: prefetch` / `Sec-Purpose: prefetch`) không được đếm. `GET /api/links/:slug` flush trước khi đọc nên số liệu vẫn chính xác.

## Cấu hình production
Nên đặt `BASE_URL` (ví dụ `https://sho.rt`) khi chạy production. Nếu không đặt, `shortUrl` được dựng từ header `Host` của request nên có thể bị giả mạo/sai khi chạy sau proxy.

## Giao diện
- `/` : trang Tạo link (URL + slug tuỳ chọn, hiện link ngắn kèm nút Copy).
- `/dashboard` : danh sách link (mới nhất trước, 20 dòng/trang, Trước/Sau), cuộn ngang trên điện thoại.
- Tailwind nạp qua CDN, JS thuần, không cần build.

## Ngôn ngữ (i18n)
Mặc định vi + en. Thứ tự chọn: cookie `lang`/localStorage (nút đổi ngôn ngữ trên menu) → `Accept-Language` / `navigator.languages` → `en` (ngôn ngữ lạ cũng về `en`). Server render sẵn `<html lang>` và văn bản đã dịch.
Thêm ngôn ngữ: tạo `public/locales/<mã>.json` (đủ key như `en.json`, gồm mọi mã lỗi `error.*`) và thêm 1 dòng `{ "code": "<mã>", "name": "<tên>" }` vào `public/locales/index.json`. Test sẽ báo nếu thiếu key.

## Quảng cáo (chỉ chuẩn bị chỗ)
Đặt `ADS_ENABLED=true` để HTML có thêm container `#ad-slot-top` và `#ad-slot-bottom` (`data-ad-slot`). Mặc định (false/không đặt) không có slot nào. Chưa tích hợp nhà quảng cáo nào.

## Biến môi trường bảo mật / giới hạn
| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `GUEST_LINKS_PER_HOUR` | 30 | Số link khách (chưa đăng nhập) được tạo mỗi giờ theo IP |
| `LOGIN_MAX_FAILS` | 5 | Số lần đăng nhập sai tối đa/15 phút theo cặp email+IP; theo IP là 5x, theo email là 3x |
| `REGISTER_PER_HOUR` | 10 | Số lần `POST /api/auth/register` mỗi giờ theo IP |
| `TRUST_PROXY` | tắt | Cấu hình `trust proxy` của Express (`true`, số hop, hoặc danh sách IP/CIDR). Chỉ bật khi chạy sau reverse proxy tin cậy, nếu không `req.ip` có thể bị giả mạo |
| `COOKIE_SECURE` | theo `NODE_ENV` | `true`/`false` ép cờ Secure của cookie phiên |
| `NODE_ENV` | - | `production` bật cookie Secure |

Lưu ý: `docker-compose.yml` đặt `NODE_ENV=production`, nên cookie có cờ Secure và trình duyệt sẽ không gửi lại qua HTTP. Khi chạy thử qua `http://localhost` hãy đặt `COOKIE_SECURE=false` (ví dụ `COOKIE_SECURE=false docker compose up`); với HTTPS để mặc định.

Khác: session hết hạn được xoá mỗi giờ và khi đăng nhập. `GET /api/links/:slug` của link thuộc người dùng chỉ trả về cho chủ sở hữu (người khác nhận 404); redirect `GET /:slug` vẫn công khai.

## Quản lý link (API)
- `PATCH /api/links/:slug` (đăng nhập, chỉ chủ link; người khác nhận 404): sửa `url`, `title`, `note`, `isActive`, `expiresAt`, `maxClicks`. `DELETE /api/links/:slug` xoá link.
- `POST /api/links` nhận thêm `title`, `note`, `expiresAt`, `maxClicks`. `GET /api/links?q=&status=active|disabled|expired&page=&pageSize=`.
- Link tắt / hết hạn / hết lượt click trả 410 (không redirect, không đếm click). `GET /preview/:slug` hiển thị URL đích trước khi đi. URL đích trỏ về chính domain dịch vụ (Host hoặc `BASE_URL`) bị từ chối với `SELF_REFERENCE`.
