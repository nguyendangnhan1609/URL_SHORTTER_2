// Test cũ tạo nhiều link khách từ cùng IP; nới giới hạn mặc định (test rate-limit tự đặt giá trị riêng).
process.env.GUEST_LINKS_PER_HOUR = '100000';
process.env.REGISTER_PER_HOUR = '100000';
