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
