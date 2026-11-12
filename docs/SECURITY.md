# Bảo mật, truy cập từ xa và mô hình đe dọa

Mặc định, ứng dụng **chỉ nghe ở `127.0.0.1`**: chỉ chính máy tính đang chạy mới mở được, kể cả máy khác cùng Wi-Fi cũng không vào được. Mọi cách truy cập từ điện thoại đều phải bật chủ động.

## 1. Truy cập từ điện thoại bằng Tailscale (khuyến nghị)

Tailscale tạo một mạng riêng được mã hóa giữa các thiết bị của bạn (dựa trên WireGuard). Ứng dụng **không mở ra Internet**: chỉ thiết bị đã đăng nhập vào tài khoản Tailscale của bạn mới thấy nó. Lệnh `tailscale serve` cấp **chứng chỉ HTTPS hợp lệ** cho tên máy, nên điện thoại cài được ứng dụng ra màn hình chính (PWA).

**Bước 1: Cài Tailscale trên máy tính.** Tải tại https://tailscale.com/download/windows, cài, đăng nhập (Google/Microsoft/GitHub).

**Bước 2: Cài Tailscale trên điện thoại** (App Store / Google Play), đăng nhập **cùng tài khoản**, bật kết nối.

**Bước 3: Bật HTTPS cho mạng Tailscale.** Mở https://login.tailscale.com/admin/dns, bật **MagicDNS** và **HTTPS Certificates**.

**Bước 4: Chia sẻ ứng dụng trong mạng riêng.** Mở *Command Prompt* (bấm Start, gõ `cmd`) và chạy:

```
tailscale serve --bg 8765
```

Lệnh in ra một địa chỉ dạng `https://ten-may.ten-tailnet.ts.net`. Lần đầu, nếu lệnh báo "Serve is not enabled", mở đường link nó đưa ra để bật tính năng rồi chạy lại lệnh. Nhờ `--bg`, việc chia sẻ vẫn chạy sau khi tắt cửa sổ và khởi động lại máy. Muốn tắt: `tailscale serve --https=443 off`.

**Bước 5: Khai báo tên máy cho ứng dụng.** Trong thư mục `finance-app`, sao chép `.env.example` thành `.env`, mở bằng Notepad, sửa dòng:

```
FINANCE_ALLOWED_HOSTS=ten-may.ten-tailnet.ts.net
FINANCE_COOKIE_SECURE=true
```

Lưu lại, tắt ứng dụng và chạy lại `run.bat`. **Giữ `FINANCE_HOST=127.0.0.1`**: Tailscale chuyển tiếp từ bên trong máy, không cần mở thêm cổng nào.

**Bước 6: Trên điện thoại**, mở địa chỉ `https://ten-may…ts.net`, đăng nhập, rồi chọn *Thêm vào màn hình chính* (Safari: nút Chia sẻ; Chrome: menu ⋮).

Kể từ đây, trên máy tính cũng nên mở bằng địa chỉ `https://…ts.net` này.

**Thu hồi điện thoại bị mất:** vào https://login.tailscale.com/admin/machines, gỡ thiết bị đó; trong ứng dụng, Cài đặt → Thiết bị đang đăng nhập → Đăng xuất thiết bị đó; đổi mật khẩu (tự đăng xuất mọi thiết bị khác).

## 2. Truy cập qua Wi-Fi nhà (LAN), không dùng Tailscale

Chỉ nên dùng trong mạng nhà tin cậy. Sửa `.env`: `FINANCE_HOST=0.0.0.0`, chạy lại `run.bat`, cửa sổ đen sẽ in địa chỉ `http://192.168.x.x:8765`. Windows có thể hỏi cho phép qua tường lửa: chỉ tick **Private networks**.

Hạn chế: kết nối là HTTP không mã hóa, nên ai cùng Wi-Fi có thể nghe lén mật khẩu và dữ liệu; không cài được PWA. **Không dùng ở quán cà phê, nhà trọ chung mạng, Wi-Fi công cộng.**

## 3. So sánh các phương án

| Phương án | Mã hóa | Lộ ra Internet | Phụ thuộc bên thứ ba | Đánh giá |
| --- | --- | --- | --- | --- |
| Chỉ trên máy tính | Không cần | Không | Không | Mặc định, an toàn nhất |
| **Tailscale serve** | Có, đầu-cuối trong mạng riêng | **Không** | Tailscale quản lý danh tính thiết bị, không đọc được nội dung | **Khuyến nghị** |
| VPN riêng (WireGuard tự dựng) | Có | Chỉ cổng VPN | Không | Tốt, nhưng cấu hình router và khóa phức tạp với người mới |
| Wi-Fi nhà (HTTP) | **Không** | Không | Không | Tạm chấp nhận trong nhà |
| Cloudflare Tunnel | Có tới Cloudflare | **Có**: trang đăng nhập công khai trên Internet | Cloudflare **giải mã** toàn bộ lưu lượng tại máy chủ của họ | Không khuyến nghị (xem dưới) |
| Mở cổng (port forwarding) trên router | Tùy | Có, trực tiếp vào máy bạn | Không | **Không dùng** |

**Rủi ro của Cloudflare Tunnel và các dịch vụ tương tự (ngrok…):**
- Kết nối HTTPS kết thúc ở máy chủ Cloudflare. Cloudflare nhìn thấy dữ liệu tài chính và mật khẩu ở dạng rõ, trái với mục tiêu "dữ liệu không phụ thuộc bên thứ ba".
- Địa chỉ là công khai. Ai cũng thử đăng nhập được, nên ứng dụng chỉ còn một lớp bảo vệ là mật khẩu. Ứng dụng có chống dò mật khẩu, nhưng mọi lỗ hổng chưa biết đều lộ ra Internet.
- Nếu buộc phải dùng, **bắt buộc** đặt Cloudflare Access (đăng nhập email/OTP trước khi tới ứng dụng), đặt `FINANCE_ALLOWED_HOSTS` và `FINANCE_COOKIE_SECURE=true`.

## 4. Các lớp bảo vệ trong ứng dụng

| Lớp | Cách làm |
| --- | --- |
| Mật khẩu | Băm bằng **Argon2id** (64 MiB bộ nhớ, 3 vòng, 4 luồng), không lưu dạng rõ. Tối thiểu 10 ký tự. |
| Lần thiết lập đầu tiên | Chỉ được tạo tài khoản từ chính máy tính chạy ứng dụng. |
| Phiên đăng nhập | Token ngẫu nhiên 256-bit; database chỉ lưu bản băm SHA-256. Cookie `HttpOnly`, `SameSite=Strict`, `Secure` khi chạy HTTPS. Hết hạn sau 14 ngày, hoặc sau 2 ngày không dùng. |
| CSRF | Mọi thao tác ghi cần header `X-CSRF-Token` riêng của phiên, kèm kiểm tra `Origin`. Đăng nhập cần header tùy chỉnh mà trang web lạ không gửi được. |
| Chống dò mật khẩu | Sai 5 lần trong 15 phút thì khóa tài khoản đó, thời gian khóa tăng gấp đôi sau mỗi lần sai thêm (tối đa 1 giờ). Giới hạn theo IP. Thông báo lỗi không tiết lộ tên đăng nhập có tồn tại hay không. Thời gian phản hồi như nhau dù tên đúng hay sai. |
| Giới hạn tốc độ | 1200 request/phút cho mỗi IP; 20/phút cho đăng nhập, mở khóa, đổi mật khẩu, khôi phục. |
| Khóa ứng dụng | Nút khóa và tự khóa sau X phút không dùng (mặc định 10). Khi khóa, **máy chủ từ chối mọi API dữ liệu** (mã 423), không chỉ che màn hình. Mở bằng PIN 6 số (băm Argon2id) hoặc mật khẩu. Sai PIN 5 lần thì buộc đăng nhập lại. |
| Phân quyền | Mọi truy vấn đều lọc theo người đang đăng nhập ở phía máy chủ. Truy cập dữ liệu của người khác trả 404. Có test riêng. |
| Header bảo mật | CSP chặt (không script ngoài, không inline), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` cho mọi API. Không tải font hay thư viện từ CDN. |
| Service worker | Chỉ lưu đệm giao diện, **không bao giờ lưu dữ liệu tài chính** trên điện thoại. |
| Log | Ghi ở `data/logs/app.log`, xoay vòng 5 file × 2 MB. Bộ lọc tự che mật khẩu, PIN, token, cookie, chuỗi băm. Không ghi nội dung request. |
| Import | Tối đa 5 MB; Excel chỉ đọc giá trị (không chạy công thức). Xuất CSV/Excel tự thêm dấu `'` trước ô bắt đầu bằng `= + - @` để chống chèn công thức. |
| Sao lưu / khôi phục | Khôi phục yêu cầu nhập lại mật khẩu, kiểm tra file là database hợp lệ, tự sao lưu dữ liệu hiện tại trước khi ghi đè. |
| Toàn vẹn tiền | Ghi tiền chạy trong transaction; tiền là số nguyên VNĐ; chuyển khoản bắt buộc tổng bằng 0; index chống trùng dữ liệu import ở mức database; xóa mềm + nhật ký thay đổi (`audit_log`). |

## 5. Mô hình đe dọa

**Tài sản cần bảo vệ:** số dư, thu nhập, công nợ, danh sách khách hàng, lịch làm việc, mật khẩu.

| Mối đe dọa | Ví dụ | Giảm thiểu | Rủi ro còn lại |
| --- | --- | --- | --- |
| Người cùng mạng Wi-Fi | Quán cà phê, nhà trọ | Mặc định chỉ localhost; từ xa qua Tailscale (mã hóa) | Nếu bật chế độ LAN ở mạng lạ |
| Mất hoặc quên khóa điện thoại | Người khác mở trình duyệt đang đăng nhập | Tự khóa + PIN; thu hồi phiên và thiết bị Tailscale | Trong vài phút trước khi tự khóa |
| Mất hoặc bị trộm máy tính | Đọc thẳng file `finance.db` | **Bật BitLocker / Device Encryption của Windows**; đặt mật khẩu Windows | Database không tự mã hóa (xem mục 6) |
| Dò mật khẩu | Thử hàng nghìn mật khẩu | Argon2id + khóa tăng dần + giới hạn tốc độ | Mật khẩu yếu do người dùng chọn |
| Trang web lạ giả lệnh (CSRF) | Mở link độc khi đang đăng nhập | SameSite=Strict + CSRF token + kiểm tra Origin | Thấp |
| Chèn mã (XSS) | Ghi chú hoặc file import chứa script | Mọi dữ liệu được escape; CSP chặn script lạ | Thấp |
| File import độc | Excel rất lớn, công thức | Giới hạn kích thước, chỉ đọc giá trị | Thấp |
| Lộ bí mật qua log hoặc chia sẻ thư mục | Gửi nhầm thư mục `data` | Lọc log; `.gitignore` | **Thư mục `data` chứa toàn bộ dữ liệu, đừng gửi cho ai** |
| Mất dữ liệu | Hỏng ổ, xóa nhầm | Sao lưu hằng ngày, xóa mềm, nhật ký thay đổi | Nếu bản sao lưu nằm cùng ổ bị hỏng: hãy chép ra USB |
| Phần mềm độc trên chính máy tính | Keylogger, mã độc đọc file | Ngoài phạm vi ứng dụng | Giữ Windows và trình diệt virus cập nhật |

## 6. Những gì ứng dụng CHƯA làm (có chủ ý)

- **Không mã hóa file database.** Mã hóa SQLite (SQLCipher) khó cài trên Windows, và khóa giải mã vẫn phải nằm đâu đó trên chính máy. BitLocker bảo vệ cả ổ đĩa, hiệu quả hơn với cùng công sức.
- **Bản sao lưu không mã hóa.** Hãy cất USB sao lưu cẩn thận như cất ví.
- **Không có xác thực hai lớp (2FA).** Khi truy cập qua Tailscale, đăng nhập Tailscale đã là một lớp thứ hai.
