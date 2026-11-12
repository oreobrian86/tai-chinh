# Tài chính & Lịch Freelance

Ứng dụng quản lý tiền bạc và lịch làm việc cho người làm quay phim, dựng phim, chụp ảnh tự do. Chạy trên máy tính Windows của bạn, dữ liệu nằm trong một file trên máy, không gửi lên dịch vụ nào.

## Cài đặt trên Windows (lần đầu)

1. **Cài Python 3.13.** Vào https://www.python.org/downloads/windows/, tải "Windows installer (64-bit)" của bản **Python 3.13** mới nhất. Khi cài, **tick ô "Add python.exe to PATH"**. Ứng dụng chạy với Python 3.12, 3.13 hoặc 3.14; **Python 3.15 chưa dùng được** vì một số thư viện chưa có bản cho 3.15. Nếu máy đã có 3.15, cứ cài thêm 3.13 song song, hoặc để `run.bat` tự cài bằng lệnh `py install 3.13`.
2. **Giải nén** thư mục `finance-app` vào nơi bạn muốn, ví dụ `D:\TaiChinh\finance-app`. Tránh để trong OneDrive hoặc Google Drive đang đồng bộ, vì file dữ liệu đang mở có thể bị hỏng khi đồng bộ.
3. **Nháy đúp `run.bat`.** Lần đầu sẽ mất 1–2 phút để tự cài thư viện (cần Internet). Các lần sau mở gần như ngay lập tức.
4. Trình duyệt tự mở `http://127.0.0.1:8765`. Tạo tài khoản: chọn tên đăng nhập và một mật khẩu dài ít nhất 10 ký tự.
5. Vào **Cài đặt → Tài khoản tiền**, bấm vào "Tiền mặt", "Ngân hàng" để nhập số dư thực tế hiện có, thêm ví MoMo/ZaloPay nếu dùng.

Nếu cài thư viện bị lỗi giữa chừng: xóa thư mục `.venv` trong `finance-app` rồi chạy lại `run.bat`.

Để tắt ứng dụng: đóng cửa sổ đen (cửa sổ dòng lệnh) hoặc nhấn `Ctrl + C` trong cửa sổ đó.

> Lần thiết lập tài khoản đầu tiên chỉ làm được ngay trên máy tính chạy ứng dụng, không làm được từ điện thoại. Đây là chủ ý, để người lạ không thể "chiếm" ứng dụng trước bạn.

## Dùng trên điện thoại

Cách khuyến nghị là **Tailscale**: an toàn, dùng được cả ở nhà lẫn ngoài đường, có HTTPS thật nên cài được thành ứng dụng trên màn hình chính. Hướng dẫn từng bước ở [docs/SECURITY.md](docs/SECURITY.md#1-truy-cap-tu-dien-thoai-bang-tailscale-khuyen-nghi).

## Cách ứng dụng tính tiền (nên đọc một lần)

| Con số | Nghĩa là | Có tính vào "Có thể tiêu" không? |
| --- | --- | --- |
| **Số dư thực có** | Tổng tiền đang thật sự nằm trong các tài khoản | Có, là điểm xuất phát |
| **Khách còn nợ** | Tiền công đã kiếm nhưng khách chưa trả | **Không bao giờ** |
| **Đang dành tiết kiệm** | Tiền bạn tự khóa cho mục tiêu và quỹ dự phòng | Bị trừ ra |
| **Sắp phải trả** | Tiền nhà, điện nước… đến hạn trong tháng | Bị trừ ra |
| **Có thể tiêu** | Số dư − tiền đã dành − khoản phải trả | Đây là kết quả |

- **Một show chỉ ghi một lần.** Khách trả cọc, trả đợt 2, trả nốt: mỗi lần chỉ bấm "Ghi nhận tiền về" và nhập số tiền. Công nợ tự giảm, tiền tự vào tài khoản. Không tạo thêm "thu nhập" mới.
- **Doanh thu ≠ tiền về.** Doanh thu tính theo ngày bạn làm show. Tiền về tính theo ngày khách trả. Báo cáo hiện cả hai, không cộng vào nhau.
- **Chuyển tiền giữa tài khoản** (rút ATM, nạp ví) không phải thu hay chi.
- **Để dành tiết kiệm không phải chi tiêu.** Tiền vẫn nằm trong tài khoản, chỉ bị giữ riêng.
- **Hủy show:** chọn giữ cọc (cọc thành doanh thu) hoặc hoàn cọc (tạo khoản hoàn tiền). Công nợ về 0.
- **Dự báo** cần ít nhất 14 ngày và 10 khoản chi mới đáng tin; trước đó ứng dụng sẽ ghi rõ "dữ liệu còn ít".

## Sao lưu

- Ứng dụng **tự sao lưu mỗi ngày** vào `data\backups`, giữ 30 bản gần nhất.
- Toàn bộ dữ liệu nằm trong `data\finance.db`. **Nên chép thư mục `data` sang USB hoặc ổ khác mỗi tuần.**
- Khôi phục: Cài đặt → Sao lưu và dữ liệu → Khôi phục. Trước khi khôi phục, ứng dụng tự lưu một bản an toàn của dữ liệu hiện tại.
- Xuất toàn bộ dữ liệu ra JSON, giao dịch ra CSV, báo cáo ra Excel: cũng trong Cài đặt.

## Nhập sao kê ngân hàng (CSV / Excel)

Chi tiêu → Nhập từ file → chọn file → ghép cột → Kiểm tra dữ liệu → Nhập. Ứng dụng:
- cho xem trước và tự đoán cột Ngày / Nội dung / Số tiền / Ghi nợ / Ghi có;
- báo dòng lỗi (ngày sai, số tiền trống);
- **không bao giờ nhập trùng**: nhập lại cùng một file thì 0 dòng mới;
- cảnh báo "nghi trùng" nếu một dòng giống khoản bạn đã nhập tay (cùng ngày, số tiền, tài khoản);
- cho **hoàn tác** cả lần nhập nếu nhầm.

## Cấu trúc thư mục

```
finance-app/
  run.bat              Nháy đúp để chạy
  run_tests.bat        Chạy bộ kiểm thử
  .env.example         Mẫu cấu hình (đổi tên thành .env nếu cần sửa)
  backend/app/         Máy chủ Python
    finance.py         NƠI DUY NHẤT chứa công thức tiền
    services.py        Nghiệp vụ ghi dữ liệu (show, giao dịch, tiết kiệm…)
    security.py        Mật khẩu Argon2id, phiên đăng nhập, chống dò mật khẩu
    migrations/        Cấu trúc database (file SQL đánh số)
  backend/tests/       45 bài kiểm thử, gồm 10 kịch bản tiền bắt buộc
  frontend/            Giao diện (HTML/CSS/JS, không cần build)
  data/                Database, sao lưu, log (tự tạo, KHÔNG chia sẻ thư mục này)
  docs/                Bảo mật, mô hình đe dọa, tiến độ
```

## Chạy kiểm thử

Nháy đúp `run_tests.bat`. Kết quả mong đợi: tất cả `passed` (test giao diện tự bỏ qua nếu chưa cài Playwright).

## Lựa chọn công nghệ và lý do

- **Backend: Python + Starlette + SQLite.** Starlette là lõi mà FastAPI xây bên trên. Mình dùng trực tiếp Starlette kèm Pydantic để validation (đúng phần FastAPI làm), vì cần chạy được bộ kiểm thử thật trong môi trường phát triển, nơi chỉ có sẵn Starlette. Cấu trúc router → service → database giống hệt FastAPI. Nếu muốn chuyển sang FastAPI sau này, chỉ phải sửa `main.py`; công thức tiền và nghiệp vụ giữ nguyên.
- **Không dùng ORM.** Truy vấn SQL viết tay trong `finance.py`/`services.py` cho dễ kiểm tra từng con số. Migration là các file `.sql` đánh số, tự chạy khi khởi động.
- **Frontend: HTML/CSS/JavaScript thuần (ES modules), biểu đồ SVG tự vẽ.** Thay cho React + TypeScript, vì: không cần cài Node.js trên Windows, không có bước build, không phụ thuộc thư viện ngoài, dễ đặt chính sách bảo mật nội dung (CSP) chặt. Đổi lại, code giao diện dài hơn một chút và không có kiểm tra kiểu của TypeScript.
- **Database sẵn cho mở rộng:** mọi bảng có `user_id`, `id` dạng UUID, `version`, `deleted_at` (xóa mềm), nên có thể thêm nhiều tài khoản người dùng hoặc đồng bộ thiết bị mà không viết lại.
