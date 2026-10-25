# URL_SHORTTER_2
bản cải tiền từ URL SHORTTER cũ.

## Chạy nhanh
- Docker: `docker compose up --build` (app tại http://localhost:3000).
- Không Docker: `npm i && DATABASE_URL=postgres://user:pass@localhost:5432/db npm start`.
- Xem file mẫu cấu hình `.env.example`.

## Chạy test
`npm test` (dùng pg-mem, không cần Postgres thật).
