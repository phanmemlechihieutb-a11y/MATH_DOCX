# MathDocx Studio

Chuyển PDF / ảnh đề toán → Word (.docx) với công thức OMML chỉnh sửa được.

Phát triển trên **Google AI Studio**, deploy production trên **Render**.

## Chạy local

```bash
npm install
cp .env.example .env
# Điền GEMINI_API_KEY vào .env

npm run dev
```

Mở http://localhost:3000  
Kiểm tra API: http://localhost:3000/api/health → phải trả JSON `{"ok":true,...}`

## Deploy lên Render (bắt buộc làm đúng)

### 1. Tạo Web Service mới trên Render

- **Runtime:** Node
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`
- **Instance:** Free hoặc Starter

Hoặc dùng Blueprint: nối repo có file `render.yaml`.

### 2. Environment Variables (Dashboard → Environment)

| Key | Value |
|-----|--------|
| `GEMINI_API_KEY` | API key từ Google AI Studio |
| `NODE_ENV` | `production` |

Không commit file `.env` lên Git.

### 3. Sau khi deploy

Mở: `https://<service>.onrender.com/api/health`

- `{"ok":true,"hasGeminiKey":true}` → OK
- HTML / lỗi → xem **Logs** trên Render (thường thiếu `GEMINI_API_KEY` hoặc build chưa tạo thư mục `dist`)

### 4. Lỗi thường gặp trên Render

| Hiện tượng | Nguyên nhân | Cách xử lý |
|------------|-------------|------------|
| HTTP 200 + `<!doctype html>` | Start command sai / không chạy Express | Start = `npm start` (tsx server.ts), không dùng `vite preview` |
| `hasGeminiKey: false` | Chưa set env | Thêm `GEMINI_API_KEY` trên Dashboard |
| Timeout / 502 khi OCR | Free tier sleep + request dài | Gửi lại; cân nhắc plan trả phí; giảm số trang / DPI |
| Build fail | Node cũ | Chọn Node 20+ |

## AI Studio

Trên AI Studio chỉ dùng để chỉnh UI/code. Bản chạy thật (OCR + export DOCX) cần server Node với `GEMINI_API_KEY` — deploy Render như trên.

## Streamlit (tùy chọn, Python)

```bash
pip install -r requirements.txt
streamlit run app.py
```
