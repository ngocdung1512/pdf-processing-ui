# PDF to DOCX Converter - Học viện Kỹ thuật và Công nghệ An ninh

Ứng dụng web chuyển đổi PDF sang DOCX với giao diện hiện đại, hỗ trợ 3 chế độ:
- **OCR cơ bản:** Trích xuất text nhanh (PDF text + PDF scan), không giữ bố cục
- **OCR nâng cao (giữ bố cục):** PDF scan hoặc phức tạp, giữ bố cục gần bản gốc
- **Trợ lý chatbot:** Hỏi đáp văn bản hành chính (AnythingLLM)

## 📋 Yêu cầu hệ thống

- **Python 3.11+** (khuyến nghị Python 3.11)
- **Node.js 18+** và npm
- **RAM:** >= 8GB+ (để chạy chế độ AI mượt mà)
- **GPU:** Tùy chọn (hỗ trợ CUDA cho tốc độ nhanh hơn)

---

## 🚀 Cài đặt từ đầu (sau khi git clone)

Làm lần đầu trên máy mới hoặc sau khi clone repo. Làm đủ các bước theo thứ tự.

### Bước 1: Clone repo

```bash
git clone <url-repo-của-bạn> pdf-processing-ui
cd pdf-processing-ui
```

Sau khi clone, repo đã bao gồm **toàn bộ** (app PDF + **OCR_LLM chatbot** trong thư mục `OCR_LLM`). Không cần clone thêm gì.

*(Nếu repo dùng Git LFS cho file model `.pt`, cần cài [Git LFS](https://git-lfs.com/) và chạy `git lfs install` trước khi clone.)*

### Bước 2: Chuẩn bị môi trường

- Đảm bảo đã cài **Python 3.11+** và **Node.js 18+** (kiểm tra: `python --version`, `node --version`, `npm --version`).
- Nếu chưa: [Python](https://www.python.org/downloads/), [Node.js](https://nodejs.org/) (LTS).

### Bước 3: Tạo và kích hoạt virtualenv Python

**Windows (PowerShell):**
```powershell
python -m venv conversion_env
.\conversion_env\Scripts\Activate.ps1
```
*Nếu báo lỗi execution policy:* `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` rồi thử lại.

**Windows (CMD):**
```cmd
python -m venv conversion_env
conversion_env\Scripts\activate.bat
```

**Mac/Linux:**
```bash
python3 -m venv conversion_env
source conversion_env/bin/activate
```

Sau khi kích hoạt, đầu dòng lệnh sẽ có `(conversion_env)`.

### Bước 4: Cài thư viện Python

Trong cùng terminal (đã kích hoạt `conversion_env`):

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

- Có thể mất 10–30 phút tùy mạng.
- Lần đầu chạy app có thể tải thêm model (vài GB).

### Bước 5: (Tuỳ chọn) DocLayout-YOLO – cho OCR nâng cao (PDF scan)

Chỉ cần nếu muốn dùng **OCR nâng cao (giữ bố cục)** cho PDF scan:

1. Clone repo DocLayout-YOLO vào thư mục gốc project, đổi tên thư mục thành `DocLayout-YOLO`.
2. Trong `conversion_env`:
   ```bash
   pip install -e ./DocLayout-YOLO
   ```
3. Đặt file model `doclayout_yolo_docstructbench_imgsz1024.pt` vào thư mục gốc project (hoặc cấu hình đường dẫn khi chạy).

Nếu chỉ dùng **OCR cơ bản** hoặc **chỉ PDF văn bản (layout)** có thể bỏ qua bước này.

### Bước 6: Cài thư viện Node.js (frontend)

Mở terminal **mới** (không cần kích hoạt Python), tại thư mục gốc `pdf-processing-ui`:

```bash
npm install
```

### Bước 7: (Tuỳ chọn) Cài Chatbot (OCR_LLM / AnythingLLM)

Code chatbot đã nằm trong repo (thư mục `OCR_LLM`). Nếu muốn dùng nút **"Mở trợ lý chatbot"**, chạy một lần:

```bash
npm run chatbot:setup
```

(Lệnh này cài dependency + Prisma cho server/frontend/collector trong `OCR_LLM`.)  
*Cần Yarn: `npm install -g yarn` nếu chưa có. Chi tiết: [OCR_LLM/CHATBOT_SETUP.md](./OCR_LLM/CHATBOT_SETUP.md).*

### Bước 8: Chạy ứng dụng

**Windows (khuyên dùng):**
```cmd
.\start-dev.bat
```
Hoặc double-click file `start-dev.bat`. Script sẽ mở backend (port 8000), frontend (port 3000) và mở trình duyệt.

**Hoặc chạy tay:** trong terminal có `conversion_env`: `uvicorn api:app --port 8000 --reload`; terminal khác: `npm run dev`.

### Truy cập

- **Giao diện chính:** http://localhost:3000  
- **Backend API:** http://localhost:8000  
- **Chatbot (nếu đã setup):** http://localhost:3002 (hoặc bấm "Mở trợ lý chatbot" trên giao diện)

---

## Hướng dẫn nhanh (đã cài xong)

> **Máy mới / clone lần đầu:** Làm theo mục **[Cài đặt từ đầu (sau khi git clone)](#-cài-đặt-từ-đầu-sau-khi-git-clone)** phía trên.  
> Chi tiết thêm: **[HUONG_DAN_CAI_DAT_MAY_MOI.md](./HUONG_DAN_CAI_DAT_MAY_MOI.md)**.

### ⚡ Quick Start (đã cài xong)

- **Kích hoạt venv:** `.\conversion_env\Scripts\Activate.ps1` (PowerShell) hoặc `conversion_env\Scripts\activate.bat` (CMD).
- **Chạy app:** `.\start-dev.bat` (Windows) hoặc double-click `start-dev.bat`.
- **Cập nhật thư viện:** `pip install -r requirements.txt` (trong venv), `npm install` (terminal khác).

### 🤖 Chatbot (OCR_LLM)

- **Cài lần đầu:** `npm run chatbot:setup` (từ thư mục gốc).
- **Chạy:** Bấm "Mở trợ lý chatbot" trên giao diện hoặc mở http://localhost:3002. Chi tiết: [OCR_LLM/CHATBOT_SETUP.md](./OCR_LLM/CHATBOT_SETUP.md).



## 🔧 Gỡ lỗi (Troubleshooting)

### Lỗi: "Python not found"
- Đảm bảo đã cài Python và thêm vào PATH
- Thử dùng `python3` thay vì `python`

### Lỗi: "Module not found" khi chạy Python
- Đảm bảo đã kích hoạt môi trường ảo: `(conversion_env)` phải xuất hiện ở đầu dòng lệnh
- Chạy lại: `pip install -r requirements.txt`

### Lỗi: "npm: command not found"
- Đảm bảo đã cài Node.js và npm
- Kiểm tra: `node --version` và `npm --version`

### Lỗi: Port 3000 hoặc 8000 đã được sử dụng
- Đóng các ứng dụng đang dùng port đó
- Hoặc thay đổi port trong lệnh chạy

### Lỗi: "Cannot activate virtual environment" (Windows PowerShell)
- Chạy lệnh: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
- Sau đó thử lại

### Lần đầu chạy chậm
- Bình thường! Lần đầu cần tải model AI (2-3GB)
- Các lần sau sẽ nhanh hơn nhiều

### Lỗi thiếu Pandoc
- Script đã tích hợp sẵn `pypandoc_binary`
- Nếu vẫn lỗi, cài thủ công: https://pandoc.org/installing.html

## 📝 Lưu ý quan trọng

1. **Luôn kích hoạt môi trường ảo** trước khi chạy backend
2. **Không đóng terminal** khi ứng dụng đang chạy
3. **File upload** sẽ được lưu trong thư mục `uploads/`
4. **Kết quả chuyển đổi** sẽ được tải về tự động sau khi hoàn thành

## Nếu gặp vấn đề, vui lòng kiểm tra:
1. Đã cài đầy đủ Python và Node.js chưa?
2. Đã kích hoạt môi trường ảo chưa?
3. Đã cài đầy đủ thư viện chưa?
4. Port 3000 và 8000 có đang bị chiếm dụng không?
