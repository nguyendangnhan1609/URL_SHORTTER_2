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
