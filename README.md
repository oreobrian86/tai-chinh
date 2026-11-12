# Tài chính & Lịch Freelance (bản Google Drive)

Ứng dụng quản lý tiền và lịch làm việc cho người làm quay phim, dựng phim, chụp ảnh tự do. Chạy trên trình duyệt (máy tính và điện thoại Android), dữ liệu lưu trong **một file Google Sheet trong Google Drive của bạn**. Trang web đặt trên GitHub Pages chỉ chứa giao diện, không chứa dữ liệu.

## Đưa lên GitHub (lần đầu)

1. Mở `config.js` bằng Notepad, thay `DAN_CLIENT_ID_VAO_DAY.apps.googleusercontent.com` bằng **Client ID** của bạn. Giữ nguyên hai dấu nháy `'...'`.
2. Vào kho `tai-chinh` trên github.com. Xóa các file cũ của bản trước, nếu còn.
3. Bấm **Add file → Upload files**. Mở thư mục đã giải nén, chọn **tất cả file và thư mục bên trong** (`index.html`, `config.js`, `css`, `js`, `icons`…), rồi kéo thả vào trang GitHub. `index.html` phải nằm ngay thư mục gốc của kho, không nằm trong thư mục con.
4. Bấm **Commit changes**. Đợi 1–2 phút rồi mở `https://ten-cua-ban.github.io/tai-chinh/`.
5. Bấm **Đăng nhập bằng Google**, chọn tài khoản. Nếu Google hiện cảnh báo *"Google chưa xác minh ứng dụng này"* (vì đây là app riêng của bạn, chưa nộp cho Google duyệt), bấm **Nâng cao → Đi tới ...**. Tick ô cho phép truy cập Drive (nếu có), rồi **Tiếp tục**.
6. Lần đầu, app tự tạo file `Tài chính & Lịch Freelance (dữ liệu)` trong Drive của bạn.

**Trên Android:** mở link bằng Chrome, bấm menu ⋮ → **Thêm vào màn hình chính** (hoặc *Cài đặt ứng dụng*).

Muốn xem giao diện khi chưa có Client ID: mở link kèm `?demo` ở cuối, ví dụ `.../tai-chinh/?demo`. Chế độ này dùng dữ liệu mẫu, không ghi gì lên Google.

## Cập nhật bản vá

Tải các file mới lên đè vào kho GitHub (Add file → Upload files). **Đừng ghi đè `config.js`** nếu bản mới không yêu cầu, để khỏi phải dán lại Client ID. Lần mở app tiếp theo, máy tính và điện thoại tự nhận bản mới. Dữ liệu trong Drive không bị ảnh hưởng.

## Đồng bộ Google Calendar (tùy chọn)

Một lần trên Google Cloud (dự án `Tai Chinh`):
1. Ô tìm kiếm → **Google Calendar API** → **Enable**. Làm tương tự với **Google Tasks API** (để lấy Việc cần làm).
2. Google Auth Platform → **Data Access** → **Add or remove scopes** → tick `.../auth/calendar.app.created` → **Update** → **Save**.

Trong app: **Đăng xuất Google**, đăng nhập lại, tick **cả hai ô** về Lịch (tạo lịch và xem lịch). Sau đó vào Cài đặt → Google Calendar:

- **Bật lấy lịch về**: sự kiện và Việc cần làm (Google Tasks, loại có đặt ngày) bạn thêm trên Google Calendar (điện thoại hay máy tính) tự hiện trong app thành *show nháp, chưa có giá*. Mặc định lấy từ lịch chính, có thể chọn lịch khác và lọc theo chữ trong tiêu đề. Bỏ qua sinh nhật và việc lặp lại hằng tuần. Đổi giờ hay xóa sự kiện trên Google thì app tự cập nhật. App chỉ đọc, không sửa lịch cá nhân. App lấy lịch khi mở, khi quay lại app và mỗi 5 phút.
- **Bật đưa lên**: show tạo trong app được đưa lên lịch riêng *Lịch làm việc freelance*, tự cập nhật khoảng 4 giây sau mỗi lần sửa. Show lấy từ Google thì không đưa lên lần nữa (tránh trùng).

## Mẹo dùng nhanh

- **Ẩn số tiền:** bấm biểu tượng con mắt cạnh "Có thể tiêu" (điện thoại) hoặc ở thanh bên (máy tính). Mọi số tiền hiện thành ••••••. Lựa chọn được nhớ chung cho mọi thiết bị.
- **Khách quen:** khi tạo show, chạm tên khách ở hàng "Khách gần đây". App tự điền loại việc, tiền công, địa điểm, giờ theo show gần nhất với khách đó.
- **Nhân bản show:** mở một show cũ → **Nhân bản show** để tạo show mới giống hệt. Tiền cọc và hạn thanh toán không được chép sang.

## Cách ứng dụng tính tiền

| Con số | Nghĩa | Có tính vào "Có thể tiêu"? |
| --- | --- | --- |
| Số dư thực có | Tiền đang thật sự có trong các tài khoản | Có, là điểm xuất phát |
| Khách còn nợ | Tiền công đã kiếm nhưng chưa nhận | **Không bao giờ** |
| Đang dành tiết kiệm | Tiền bạn tự giữ riêng cho mục tiêu và quỹ dự phòng | Bị trừ ra |
| Sắp phải trả | Tiền nhà, điện nước… đến hạn trong tháng | Bị trừ ra |

- **Một show chỉ ghi một lần.** Khách trả từng đợt thì chỉ cần bấm "Ghi nhận tiền về". Công nợ tự giảm, không tạo thêm thu nhập mới.
- **Doanh thu tính theo ngày làm, tiền về tính theo ngày nhận.** Hai số này không cộng vào nhau.
- **Chuyển tiền giữa tài khoản** không phải thu hay chi. **Để dành tiết kiệm** không phải chi tiêu.
- **Dự báo** cần ít nhất 14 ngày và 10 khoản chi mới đáng tin.

## Bảo mật

- **Bật xác thực 2 lớp** cho cả tài khoản GitHub lẫn Google. Đây là hai chìa khóa duy nhất.
- App chỉ có quyền `drive.file`: chỉ đọc/ghi file do chính nó tạo, không xem được file khác trong Drive.
- Quyền đăng nhập chỉ nằm trong bộ nhớ trình duyệt và tự hết hạn sau khoảng 1 giờ. Khi khóa app (nút Khóa, hoặc tự khóa sau 10 phút không dùng), dữ liệu bị xóa khỏi bộ nhớ. Không có dữ liệu tài chính nào lưu trên điện thoại.
- **Mất điện thoại:** vào myaccount.google.com → Bảo mật → Thiết bị của bạn → đăng xuất thiết bị đó.
- Chỉ mở app bằng icon trên màn hình chính hoặc link của chính bạn, không bấm link lạ.
- Không sửa tay file Google Sheet dữ liệu (xem thì được). Nếu lỡ sửa sai: mở Sheet → Tệp → Nhật ký phiên bản để quay lại.

## Sao lưu

- App tự tạo bản sao file dữ liệu mỗi ngày trong Drive, giữ 30 bản gần nhất. Cài đặt → **Sao lưu ngay** để sao lưu thủ công.
- Khôi phục: Cài đặt → bấm **Khôi phục** cạnh một bản sao lưu, hoặc **Khôi phục từ file JSON**. App luôn tự sao lưu dữ liệu hiện tại trước khi khôi phục.
- File JSON xuất từ bản chạy trên máy tính trước đây cũng khôi phục được vào bản này.

## Nhập sao kê ngân hàng

Chi tiêu → Nhập từ file. Chỉ nhận **CSV**. Với file Excel, mở bằng Excel hoặc Google Sheets rồi lưu/tải xuống dạng `.csv`. App cho xem trước, ghép cột, báo dòng lỗi, không bao giờ nhập trùng (nhập lại cùng file thì 0 dòng mới), và cho hoàn tác cả lần nhập.

## Cấu trúc

```
index.html, config.js      Trang chính, cấu hình Client ID
css/app.css                Giao diện
js/core/finance.js         NƠI DUY NHẤT chứa công thức tiền
js/core/services.js        Nghiệp vụ: show, giao dịch, tiết kiệm, lịch…
js/core/store.js           Đọc/ghi Google Sheet (mỗi lần ghi là một lệnh nguyên khối)
js/core/router.js          "Máy chủ" chạy ngay trong trình duyệt
js/views/                  Các trang
tests/                     Kiểm thử (Node.js + trình duyệt)
```

Chạy kiểm thử (cần Node.js 20+): `node --test tests/*.test.mjs`.


## Đăng nhập và tự khóa

- Bấm F5 hay mở lại app trong cùng tab thì vào thẳng, không phải đăng nhập lại, trong khoảng 1 giờ kể từ lần đăng nhập (giới hạn của Google). Hết giờ thì app hỏi đăng nhập lại bằng một lần bấm, dữ liệu đang xem không mất.
- Phiên đăng nhập chỉ nằm trong tab đó (sessionStorage), tự xóa khi đóng tab/app, khi bấm Khóa hoặc khi hết hạn.
- Tự khóa khi không dùng: chỉnh ở Cài đặt → Bảo mật (mặc định 10 phút).

## Công nợ và tiền dự kiến

- **Tình trạng công việc** (Chưa làm / Đang làm / Đã làm xong) không liên quan đến tiền. Tiền chỉ vào tài khoản khi bấm **Ghi nhận tiền về**.
- **Dự kiến**: show chưa làm xong đã có giá. **Công nợ**: show đã làm xong (hoặc quá hạn thanh toán) mà khách chưa trả đủ. Cả hai đều không tính vào tiền có thể tiêu.

## Khoản phải trả, ngân sách

- Chi cố định hằng tháng/hằng năm (wifi, CapCut…), trả sau và trả góp nhiều kỳ (SPayLater…). Trả xong kỳ này, kỳ sau tự được thêm; được nhắc trước 3 ngày ở Tổng quan, và trên Google Calendar (9 giờ sáng hôm trước) nếu bật đưa lịch lên.
- Ngân sách tiêu xài mỗi tháng: đặt ở Chi tiêu → Khoản phải trả.

## Gõ câu ngắn

Bấm **Thêm nhanh → Gõ câu**, mỗi dòng một việc, ví dụ `ăn trưa 45k`, `15/12 quay cưới Linh 6tr5 cọc 2tr`, `anh Minh ck 2tr`, `wifi 220k hàng tháng ngày 5`. App đọc ngay trên máy (không gửi chữ đi đâu), cho xem trước rồi mới lưu.
