# Hướng dẫn cài trên máy mới (làm theo từng bước)

Tài liệu này dành cho trường hợp cài mới hoàn toàn.  
Chỉ cần làm đúng thứ tự từ trên xuống là chạy được app.

---

## 0) Kết quả mong muốn sau khi cài xong

- Mở app chính tại `http://localhost:3000`
- Backend chạy tại `http://localhost:8000`
- (Tùy chọn) Chatbot AnythingLLM chạy tại `http://localhost:3002`
- Chế độ OCR nâng cao dùng được với model Qwen local

---

## 1) Cài phần mềm nền tảng (chỉ làm 1 lần/máy)

### 1.1 Cài Git

- Download: [https://git-scm.com/download/win](https://git-scm.com/download/win)
- Kiểm tra:

```powershell
git --version
```

### 1.2 Cài Git LFS (bắt buộc)

Model `.pt` trong repo dùng Git LFS, thiếu bước này sẽ clone không đủ file.

- Download: [https://git-lfs.com/](https://git-lfs.com/)
- Chạy 1 lần:

```powershell
git lfs install
```

### 1.3 Cài Python 3.11+

- Download: [https://www.python.org/downloads/](https://www.python.org/downloads/)
- Khi cài nhớ tick `Add Python to PATH`
- Kiểm tra:

```powershell
python --version
pip --version
```

Nếu máy dùng launcher:

```powershell
py --version
```

### 1.4 Cài Node.js 18+ (LTS)

- Download: [https://nodejs.org/](https://nodejs.org/)
- Kiểm tra:

```powershell
node --version
npm --version
```

### 1.5 (Khuyên dùng) Cài Ollama cho Chatbot local

- Download: [https://ollama.com/download](https://ollama.com/download)
- Kiểm tra:

```powershell
ollama --version
```

---

## 2) Clone project và cài dependency

> Ví dụ dưới đây dùng thư mục `D:\work`. Bạn có thể đổi sang nơi khác.

### 2.1 Clone repo

```powershell
cd D:\work
git clone https://github.com/ngocdung1512/pdf-processing-ui.git
cd pdf-processing-ui
```

Kiểm tra có file model YOLO đi kèm:

```powershell
dir doclayout_yolo_docstructbench_imgsz1024.pt
```

Nếu không thấy file này: cài lại Git LFS, rồi clone lại repo.

### 2.2 Tạo virtual environment Python

```powershell
python -m venv conversion_env
.\conversion_env\Scripts\Activate.ps1
```

Nếu PowerShell chặn script:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 2.3 Cài thư viện Python

```powershell
pip install --upgrade pip
pip install -r requirements.txt
```

### 2.4 Cài DocLayout-YOLO (bắt buộc nếu dùng OCR nâng cao)

Trong root project (cùng cấp `api.py`):

```powershell
git clone https://github.com/naver-ai/doclayout.git DocLayout-YOLO
pip install -e .\DocLayout-YOLO
```

### 2.5 Cài frontend dependency

Mở terminal mới (không cần bật venv):

```powershell
cd D:\work\pdf-processing-ui
npm install
```

### 2.6 (Tùy chọn) Cài chatbot dependency

```powershell
npm install -g yarn
npm run chatbot:setup
```

---

## 3) Model OCR nâng cao (Qwen2.5-VL-3B) - trạng thái hiện tại

Theo setup của bạn hiện tại, model OCR nâng cao đã có sẵn trong project:

- `Qwen2.5-VL-3B` (root project)

=> Khi cài máy mới, nếu bạn đã copy/clone đầy đủ thư mục này thì **không cần tải lại**.

Chỉ khi thiếu thư mục model mới cần tải thêm từ Hugging Face.

Nếu muốn đặt model ở ổ khác (ví dụ `E:\AI_Models\Qwen2.5-VL-3B`), truyền tham số:

- `--ocr-model E:\AI_Models\Qwen2.5-VL-3B`

---

## 4) Chạy ứng dụng

### 4.1 Cách dễ nhất

- Double click file `start-dev.bat` ở root project

Script sẽ tự mở backend + frontend (+ chatbot core nếu có setup).

### 4.2 Cách chạy bằng lệnh

```powershell
cd D:\work\pdf-processing-ui
.\start-dev.bat
```

Mở trình duyệt:

- `http://localhost:3000`

---

## 5) Setup model cho Chatbot (AnythingLLM)

Phần này mới là phần bạn cần cho máy mới: model Qwen dùng để chat trong AnythingLLM.

### 5.1 Nếu bạn chạy Chatbot bằng Ollama (khuyên dùng local)

Sau khi cài Ollama, kéo model chat về máy:

```powershell
ollama pull qwen2.5:7b
```

Kiểm tra:

```powershell
ollama list
```

Nếu `Workspace Chat model` trống:

1. Kiểm tra `ollama list` có model chưa
2. Đảm bảo Ollama service đang chạy
3. Reload trang AnythingLLM
4. Provider phải là `Ollama`

### 5.2 Nếu bạn dùng model Qwen tự host từ Hugging Face

Vì model này là của bạn đẩy lên Hugging Face, tài liệu mẫu cho 4 model đã được thêm ở:

- `MODELS_TO_DOWNLOAD.md` -> mục `Chatbot Qwen models (4 models you pushed to Hugging Face)`

Trên máy mới, chỉ cần thay ID thật rồi chạy đúng các lệnh `snapshot_download`.

Bạn có thể điền lại nhanh theo template:

- HF repo: `<YOUR_HF_REPO_FOR_CHATBOT>`
- Cách load: `<OLLAMA / VLLM / LM STUDIO / endpoint URL>`
- Tên model hiển thị trong AnythingLLM: `<MODEL_NAME_SHOWN_IN_WORKSPACE_CHAT_MODEL>`
- API key/token (nếu có): `<WHERE_TO_SET>`

Khuyến nghị: lưu rõ mapping vào một bảng trong tài liệu nội bộ để máy mới chỉ copy y chang.

---

## 6) Cần đổi đường dẫn thì đổi ở đâu?

Phần này là checklist nhanh khi chuyển máy/đổi ổ đĩa.

### 6.1 Đường dẫn model Qwen OCR (PDF OCR nâng cao)

- File: `process_pdf_to_docx.py`
- Biến mặc định: `ocr_model_path`
- Mặc định hiện tại: `./Qwen2.5-VL-3B`

Bạn có thể:

- Giữ nguyên và đặt model đúng thư mục này.
- Hoặc truyền `--ocr-model <duong_dan_moi>`.

### 6.2 Đường dẫn model YOLO layout

- File: `process_pdf_to_docx.py`
- Biến mặc định: `model_path`
- Mặc định hiện tại: `./doclayout_yolo_docstructbench_imgsz1024.pt`

### 6.3 URL API cho frontend chatbot

- File: `OCR_LLM/frontend/.env`
- Giá trị cần có:

```env
VITE_API_BASE=http://localhost:4101/api
```

### 6.4 Nơi cấu hình provider/model cho chatbot

- Trong UI AnythingLLM:
  - `Settings -> LLM Preferences` (system level)
  - `Workspace Settings -> Chat Settings` (workspace level)
- Mục cần chọn:
  - Provider (`Ollama` hoặc provider bạn dùng)
  - Model tương ứng (danh sách `Workspace Chat model`)

### 6.5 Script download model phụ

- File: `scripts/download-missing-models.ps1`
- Script này tải `vgg_transformer.pth` + warm up PaddleOCR cache

Chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\download-missing-models.ps1
```

---

## 7) Trình tự cài nhanh (copy/paste cho máy mới)

```powershell
# 1) Clone
cd D:\work
git lfs install
git clone https://github.com/ngocdung1512/pdf-processing-ui.git
cd pdf-processing-ui

# 2) Python env
python -m venv conversion_env
.\conversion_env\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt

# 3) Frontend
npm install

# 4) Chatbot setup (optional)
npm install -g yarn
npm run chatbot:setup

# 5) OCR model Qwen2.5-VL-3B đã có sẵn theo setup hiện tại (skip nếu đã có)

# 6) Ollama model for chatbot (optional but recommended)
ollama pull qwen2.5:7b

# 7) Run app
.\start-dev.bat
```

---

## 8) Lỗi thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý nhanh |
|---|---|---|
| Double click `start-dev.bat` nhưng lỗi | Chạy sai file `.bat` hoặc sai thư mục | Chạy file `start-dev.bat` ở root project |
| `Workspace Chat model` trống | Ollama chưa có model hoặc chưa chạy | `ollama list`, rồi `ollama pull ...`, reload AnythingLLM |
| OCR nâng cao báo không thấy Qwen | Thiếu thư mục `Qwen2.5-VL-3B` | Tải model đúng path hoặc truyền `--ocr-model` |
| Thiếu `doclayout_yolo` | Chưa cài DocLayout-YOLO editable | `pip install -e ./DocLayout-YOLO` |
| Không activate được venv | PowerShell policy chặn | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

---

## 9) Tài liệu liên quan

- Tổng quan dự án: `README.md`
- Danh sách model cần tải: `MODELS_TO_DOWNLOAD.md`
- Hướng dẫn chatbot chi tiết: `OCR_LLM/CHATBOT_SETUP.md`
