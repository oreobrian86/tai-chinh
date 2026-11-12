# Tiến độ và kết quả kiểm thử

Bản 1.0, ngày 11/11/2026. Đã gộp cả 6 phase vào bản này theo yêu cầu "viết ra sản phẩm luôn".

## Đã hoàn thành

| Phân hệ | Trạng thái |
| --- | --- |
| Đăng nhập, thiết lập lần đầu, đổi mật khẩu, PIN, khóa/tự khóa, quản lý thiết bị đăng nhập | Xong |
| Tổng quan: có thể tiêu, đường chạy tiền (số ngày đủ dùng), số dư, công nợ, tiết kiệm, khoản phải trả, thu/chi tháng, tình hình sử dụng tiền, 4 biểu đồ, lịch 2 tuần, khách đang nợ, cảnh báo | Xong |
| Thu nhập: show nhiều ngày/nhiều công đoạn, cọc, thanh toán nhiều đợt, lịch sử thanh toán, hủy show (giữ/hoàn cọc), thu khác | Xong |
| Công nợ cần thu: theo khách, quá hạn bao nhiêu ngày, lịch sử trả từng lần, ghi nhận nhanh | Xong |
| Chi tiêu: thêm nhanh 1 tay, danh mục tự tạo/sửa/xóa (chuyển giao dịch sang danh mục khác), lọc ngày/tháng/danh mục/tài khoản, tìm kiếm, sửa/xóa, tổng hôm nay/tuần/tháng, biểu đồ từng ngày | Xong |
| Chuyển khoản giữa tài khoản (kèm phí), điều chỉnh số dư | Xong |
| Khoản phải trả (một lần / hằng tháng), ghi nhận đã trả | Xong |
| Nhập CSV/Excel: xem trước, ghép cột, báo lỗi, chống trùng, nghi trùng, hoàn tác | Xong |
| Dự báo: TB 30/90 ngày, TB 3 tháng, số ngày đủ dùng, ngày hết tiền, mức chi an toàn/ngày, tiêu được trong tuần, số dư cuối tháng (thận trọng/lạc quan), cảnh báo thiếu dữ liệu | Xong |
| Tiết kiệm: nhiều mục tiêu, quỹ dự phòng, dành/rút, kế hoạch tháng, đánh giá khả thi | Xong |
| Lịch: tháng / tuần / danh sách / hôm nay, phân biệt ngày quay/chụp/dựng/nghỉ/hạn bàn giao, cảnh báo trùng giờ, tổng ngày/giờ/tiền công, dự báo thu từ show đã nhận | Xong |
| Báo cáo: từng tháng, so sánh 2 tháng, xuất Excel/CSV | Xong |
| Sao lưu tự động hằng ngày, sao lưu thủ công, tải về, khôi phục, xuất toàn bộ JSON | Xong |
| Responsive (máy tính, laptop, tablet, điện thoại), PWA cài ra màn hình chính | Xong |
| Tài liệu: README (cài Windows), SECURITY (Tailscale, mô hình đe dọa) | Xong |

## Kết quả kiểm thử (lần chạy cuối, môi trường Linux, Python 3.13, Chrome)

```
45 passed
```

- `test_money_scenarios.py`: 11 test, phủ đủ 10 kịch bản tiền bắt buộc (show 1,5tr/cọc 500k/trả 2 đợt, không ghi trùng, chi 100k, chuyển khoản, tiết kiệm, hủy show giữ/hoàn cọc, import không nhân đôi, dự báo loại trừ công nợ và quỹ dự phòng) + khoản phải trả.
- `test_security.py`: 16 test: băm mật khẩu, CSRF, Origin, chống dò mật khẩu, khóa/PIN, cô lập dữ liệu giữa người dùng, đổi mật khẩu thu hồi phiên, header, log không chứa bí mật, khôi phục cần mật khẩu.
- `test_features.py`: 17 test: danh mục, sửa/xóa giao dịch, validation, tổng hợp ngày/tuần/tháng, lịch nhiều ngày + trùng giờ, công nợ quá hạn, toán mục tiêu, báo cáo, xuất file, sao lưu/khôi phục thật, import Excel ghi nợ/ghi có, bộ đọc số tiền/ngày.
- `test_ui_e2e.py`: 1 kịch bản trình duyệt thật: tạo tài khoản, thêm chi bằng nút Thêm nhanh, tạo show có cọc, ghi nhận tiền từ trang Công nợ, mở mọi trang, khóa/mở khóa, điện thoại 390px (thêm chi, menu Thêm, kiểm tra không tràn ngang ở 10 trang), và **không có lỗi JavaScript/CSP nào trên console**.

Lỗi tìm ra và đã sửa nhờ kiểm thử trình duyệt: nút "+" trên điện thoại bị che do một dòng danh sách đẩy trang tràn ngang; nhãn khả thi tràn ô trên trang Tiết kiệm; hộp thoại giành con trỏ khi đang gõ; điện thoại thiếu đường vào Tiết kiệm/Báo cáo/Cài đặt; tài khoản mới hiển thị "tiền đã hết" thay vì hướng dẫn nhập số dư.

## Chưa kiểm thử được (cần bạn thử)

- **Chạy trên Windows thật** (`run.bat`): mình viết và kiểm thử trên Linux. Code dùng thư viện đa nền tảng và không dùng gì riêng của Linux, nhưng `run.bat` chưa được chạy trên máy Windows thật.
- **Tailscale với điện thoại thật**: hướng dẫn theo tài liệu chính thức của Tailscale, chưa thử trên thiết bị thật.
- **Safari trên iPhone**: kiểm thử dùng Chrome giả lập kích thước iPhone.
- **Sao kê thật của ngân hàng bạn dùng**: bộ nhập đã thử với CSV/Excel mẫu (dấu chấm/phẩy, ghi nợ/ghi có, ngày dd/mm/yyyy). Mỗi ngân hàng có định dạng riêng; nếu file của bạn đọc sai, gửi mình vài dòng mẫu (đã xóa thông tin nhạy cảm).

## Chưa làm (có thể bổ sung sau)

- Nhắc nhở công nợ đến hạn qua thông báo điện thoại.
- Chi phí riêng cho từng show (thuê phụ quay…) để tính lãi từng show: database đã hỗ trợ gắn `job_id` vào khoản chi, chưa có giao diện.
- Nhiều người dùng / đồng bộ nhiều máy: database đã sẵn sàng, chưa có giao diện.
- Chế độ tối (dark mode).
