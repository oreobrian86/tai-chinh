// CẤU HÌNH — chỉ cần sửa dòng CLIENT_ID bên dưới.
// Client ID lấy ở Google Cloud → Google Auth Platform → Clients (dạng ....apps.googleusercontent.com).
// Client ID được thiết kế để công khai, để ở đây là bình thường. KHÔNG dán "Client secret" vào đây.
export const CONFIG = {
  CLIENT_ID: '465503547302-omgf2go5hta0uou6oibm4r3r9h7ugjg5.apps.googleusercontent.com',
  // Quyền hẹp nhất: app chỉ đọc/ghi các file do chính nó tạo trong Google Drive của bạn.
  SCOPE: 'https://www.googleapis.com/auth/drive.file',
  // Tùy chọn: tạo và quản lý MỘT lịch riêng của app trên Google Calendar (đẩy lịch làm việc lên).
  CALENDAR_SCOPE: 'https://www.googleapis.com/auth/calendar.app.created',
  // Tùy chọn: CHỈ ĐỌC lịch của bạn để lấy sự kiện mới về thành show nháp. App không sửa, không xóa lịch cá nhân.
  CALENDAR_READ_SCOPE: 'https://www.googleapis.com/auth/calendar.readonly',
  // Tùy chọn: CHỈ ĐỌC Việc cần làm (Google Tasks) có đặt ngày để lấy về thành show nháp.
  TASKS_READ_SCOPE: 'https://www.googleapis.com/auth/tasks.readonly',
};
