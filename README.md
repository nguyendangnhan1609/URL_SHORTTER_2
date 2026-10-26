# URL_SHORTENER_2
bản cải tiền từ URL SHORTTER cũ.

## Tính năng
- **Tài khoản**: đăng ký, đăng nhập, đăng xuất, đổi mật khẩu; mỗi người chỉ thấy và quản lý link của mình. Khách chưa đăng nhập vẫn tạo được link (giới hạn theo IP).
- **Quản lý link**: sửa URL/tiêu đề/ghi chú, bật/tắt, đặt hạn dùng và giới hạn lượt click, xoá, tìm kiếm và lọc theo trạng thái, phân trang.
- **Thống kê**: tổng click, 30 ngày theo ngày, top referrer, thiết bị và trình duyệt.
- **Mã QR** cho mỗi link.
- **Tạo hàng loạt**: tối đa 50 URL mỗi lần, lỗi từng dòng không ảnh hưởng dòng khác.
- **Xem trước**: `/preview/:slug` hiển thị URL đích trước khi chuyển hướng.
- **Đa ngôn ngữ**: tiếng Việt và tiếng Anh.
- **Trang chủ**: form tạo link nhanh, kèm nút Copy.

## Chạy thử trong 3 bước
1. Khởi chạy (cần Docker):
   ```
   COOKIE_SECURE=false docker compose up --build
   ```
   `COOKIE_SECURE=false` cần khi chạy qua `http://localhost`, nếu không cookie phiên có cờ Secure và đăng nhập sẽ không giữ được. Dùng `PORT=<cổng>` nếu muốn đổi cổng host (mặc định 3000).
2. Mở http://localhost:3000 (hoặc đúng cổng bạn đã đặt bằng `PORT`).
3. Vào `/register` đăng ký tài khoản, sau đó tạo link ở trang chủ hoặc trên `/dashboard`.

Chạy test: `npm i` rồi `npm test`. Test dùng pg-mem (Postgres trong bộ nhớ), không cần Postgres thật hay Docker.

## Lưu ý đã biết
- Tailwind được tải qua CDN (`cdn.tailwindcss.com`), nên giao diện cần internet.
- Chưa có quên mật khẩu qua email (chưa tích hợp dịch vụ email).
- Bảng `link_clicks` chưa có cơ chế dọn dữ liệu cũ, dữ liệu sẽ tăng theo số click.
- Cache redirect nằm trong bộ nhớ tiến trình, nên hiện chỉ nên chạy 1 instance.
- Chưa kiểm giao diện bằng trình duyệt thật.
- Migration 001–004 đã smoke test trên Postgres thật (embedded-postgres, không qua Docker compose).

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

## Thống kê và tạo hàng loạt (API)
- `GET /api/links/:slug/stats` (đăng nhập, chỉ chủ link; người khác / link khách nhận 404): `{ total, last7days, byDay, byReferrer, byDevice, byBrowser }`. `byDay` luôn đủ 30 ngày liên tục (UTC, cũ → mới, ngày không có click = 0); `last7days` là tổng 7 ngày cuối của `byDay`; `byReferrer` top 10 (`referrer` = hostname hoặc `direct`); `byDevice` = `desktop|mobile|tablet|bot-unknown`; `byBrowser` = `chrome|firefox|safari|edge|other`. `total` lấy từ bộ đếm của link (gồm cả click trước khi có thống kê chi tiết).
- UI (T9b): `GET /api/links` trả thêm `summary: { totalLinks, totalClicks }` (toàn bộ link của user, không phụ thuộc bộ lọc); `GET /api/links/:slug` trả thêm `shortUrl`, `status`. Trang `/dashboard/links/:slug` (chỉ chủ link: chưa đăng nhập -> 302 `/login`, người khác/link khách/không tồn tại -> 404 HTML) lấy dữ liệu từ hai API này và `/stats`.
- Chi tiết click lưu ở bảng `link_clicks` (thời điểm, hostname referrer, thiết bị, trình duyệt; KHÔNG lưu IP hay User-Agent gốc), ghi theo lô cùng luồng đếm click nên không làm chậm redirect. HEAD/prefetch không được ghi. Xoá link sẽ xoá chi tiết (ON DELETE CASCADE).
- Link có `maxClicks` được tăng click nguyên tử trong DB (`UPDATE ... WHERE clicks < max_clicks`), nên song song cũng không vượt giới hạn; khi hết lượt trả 410.
- `POST /api/links/bulk` (đăng nhập, cần header CSRF): body `{ "urls": [...] }`, tối đa 50 (quá → 400 `BULK_TOO_MANY`; rỗng/sai kiểu → 400 `INVALID_BODY`). Trả `{ results: [{ index, ok: true, link } | { index, ok: false, error }], created, failed }`; mỗi dòng lỗi (`INVALID_URL`, `SELF_REFERENCE`, ...) không ảnh hưởng dòng khác. Slug luôn tự sinh. Body tối đa 200KB cho route này.
