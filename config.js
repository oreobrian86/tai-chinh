// CẤU HÌNH — chỉ cần sửa dòng CLIENT_ID bên dưới.
// Client ID lấy ở Google Cloud → Google Auth Platform → Clients (dạng ....apps.googleusercontent.com).
// Client ID được thiết kế để công khai, để ở đây là bình thường. KHÔNG dán "Client secret" vào đây.
export const CONFIG = {
  CLIENT_ID: '465503547302-omgf2go5hta0uou6oibm4r3r9h7ugjg5.apps.googleusercontent.com',
  // Quyền hẹp nhất: app chỉ đọc/ghi các file do chính nó tạo trong Google Drive của bạn.
  SCOPE: 'https://www.googleapis.com/auth/drive.file',
};
