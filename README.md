# PDF to DOCX Converter - Học viện Kỹ thuật và Công nghệ An ninh

Ứng dụng web chuyển đổi PDF sang DOCX với giao diện hiện đại, hỗ trợ 2 chế độ:
- **Chế độ OCR (AI):** Tối ưu cho PDF scan, tài liệu học thuật, toán học, bảng biểu phức tạp
- **Chế độ Layout:** Tối ưu cho văn bản hành chính, giữ nguyên bố cục 100%

## 📋 Yêu cầu hệ thống

- **Python 3.11+** (khuyến nghị Python 3.11)
- **Node.js 18+** và npm
- **RAM:** >= 8GB+ (để chạy chế độ AI mượt mà)
- **GPU:** Tùy chọn (hỗ trợ CUDA cho tốc độ nhanh hơn)

## Hướng dẫn cài đặt và chạy ứng dụng

> **Máy mới / clone lần đầu:** Xem **[HUONG_DAN_CAI_DAT_MAY_MOI.md](./HUONG_DAN_CAI_DAT_MAY_MOI.md)** để có hướng dẫn chi tiết từ Git clone đến khi chạy được.

### 📥 Clone từ GitHub (máy mới)

Nếu bạn clone repo về máy mới:

```bash
git clone <url-repo-của-bạn> pdf-processing-ui
cd pdf-processing-ui
```

Sau đó làm theo **Cài đặt lần đầu** bên dưới (tạo venv, `pip install -r requirements.txt`, `npm install`).

**Lưu ý:** Thư mục `DocLayout-YOLO` và file model `.pt` **không** nằm trong repo (do dung lượng lớn / .gitignore). Để dùng **chế độ OCR (AI)** bạn cần:

1. Clone [DocLayout-YOLO](https://github.com/naver-ai/doclayout) (hoặc repo chứa YOLOv10 doclayout) vào thư mục gốc project, đổi tên thư mục thành `DocLayout-YOLO`.
2. Cài editable: `pip install -e ./DocLayout-YOLO`
3. Đặt file model `doclayout_yolo_docstructbench_imgsz1024.pt` vào thư mục gốc project (hoặc chỉ đường dẫn bằng tham số `--model` khi chạy).

Nếu chỉ cần **chế độ Layout** (PDF văn bản) có thể bỏ qua DocLayout-YOLO và vẫn chạy được phần chuyển đổi layout.

### ⚡ Quick Start (Nếu đã có môi trường ảo `conversion_env`)

Nếu folder `conversion_env` đã tồn tại, chỉ cần:

1. **Kích hoạt môi trường ảo:**
   ```powershell
   # Windows PowerShell
   .\conversion_env\Scripts\Activate.ps1
   
   # Windows CMD
   conversion_env\Scripts\activate.bat
   
   # Mac/Linux
   source conversion_env/bin/activate
   ```

2. **Cài đặt thư viện (nếu chưa cài hoặc cần cập nhật):**
   ```bash
   # Cài thư viện Python
   pip install -r requirements.txt
   
   # Cài thư viện Node.js (mở terminal mới, không cần kích hoạt môi trường)
   npm install
   ```

3. **Chạy ứng dụng:**
   ```cmd
   # Windows - Chỉ cần double-click hoặc chạy:
   .\start-dev.bat
   ```

Script `start-dev.bat` sẽ tự động kích hoạt môi trường và chạy cả frontend + backend!

---

###  Cài đặt lần đầu (Chưa có môi trường ảo)

### Bước 1: Kiểm tra Python và Node.js

Mở terminal/command prompt và kiểm tra:

```bash
# Kiểm tra Python
python --version
# hoặc
python3 --version

# Kiểm tra Node.js
node --version
npm --version
```

Nếu chưa có, tải về tại:
- Python: https://www.python.org/downloads/
- Node.js: https://nodejs.org/

### Bước 2: Tạo môi trường ảo Python

**Chỉ cần làm bước này nếu chưa có folder `conversion_env`!**

**Windows (PowerShell hoặc CMD):**
```bash
python -m venv conversion_env
```

**Mac/Linux:**
```bash
python3 -m venv conversion_env
```

### Bước 3: Kích hoạt môi trường ảo

**Windows (PowerShell):**
```powershell
.\conversion_env\Scripts\Activate.ps1
```

**Windows (CMD):**
```cmd
conversion_env\Scripts\activate.bat
```

**Mac/Linux:**
```bash
source conversion_env/bin/activate
```

Sau khi kích hoạt thành công, bạn sẽ thấy `(conversion_env)` ở đầu dòng lệnh.

### Bước 4: Cài đặt thư viện Python

Đảm bảo đã kích hoạt môi trường ảo, sau đó chạy:

```bash
pip install -r requirements.txt
```

**Lưu ý:** 
- Quá trình này có thể mất 10-30 phút tùy tốc độ mạng
- Lần đầu chạy sẽ tải các model AI (khoảng 2-3GB)
- Nếu gặp lỗi với PyTorch, hãy kiểm tra phiên bản Python và CUDA của bạn

### Bước 5: Cài đặt thư viện Node.js

Mở terminal mới (không cần kích hoạt môi trường Python), chạy:

```bash
npm install
```

Hoặc nếu dùng yarn:
```bash
yarn install
```

### Bước 6: Chạy ứng dụng

Có 3 cách để chạy ứng dụng:

#### Cách 1: Chạy bằng npm script (Khuyên dùng - 1 terminal)

**Bước 6.1:** Kích hoạt môi trường Python trong terminal hiện tại:
```powershell
# Windows PowerShell
.\conversion_env\Scripts\Activate.ps1

# Windows CMD
conversion_env\Scripts\activate.bat

# Mac/Linux
source conversion_env/bin/activate
```

**Bước 6.2:** Chạy lệnh:
```bash
npm run dev:all
```

Lệnh này sẽ tự động chạy cả frontend (port 3000) và backend (port 8000) trong cùng 1 terminal.

#### Cách 2: Chạy bằng script tự động (Windows) - ⭐ Khuyên dùng

**Windows CMD:**
```cmd
.\start-dev.bat
```

Hoặc **double-click** vào file `start-dev.bat`

**Windows PowerShell:**
```powershell
.\start-dev.ps1
```

Script sẽ tự động:
- Kích hoạt môi trường ảo (nếu chưa kích hoạt)
- Mở cửa sổ mới cho backend
- Chạy frontend trong terminal hiện tại
- Tự động mở trình duyệt tại http://localhost:3000

#### Cách 3: Chạy thủ công (2 terminal riêng)

**Terminal 1 - Backend (nhớ kích hoạt môi trường ảo trước):**
```bash
# Kích hoạt môi trường ảo
.\conversion_env\Scripts\Activate.ps1  # Windows PowerShell
# hoặc
conversion_env\Scripts\activate.bat    # Windows CMD
# hoặc
source conversion_env/bin/activate     # Mac/Linux

# Chạy backend
uvicorn api:app --port 8000 --reload
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

### Bước 7: Truy cập ứng dụng

Sau khi chạy thành công, mở trình duyệt và truy cập:

- **Frontend (Giao diện):** http://localhost:3000
- **Backend API:** http://localhost:8000



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

## 🤖 Hướng dẫn cài đặt Chatbot RAG (Hỗ trợ giải đáp thắc mắc văn bản hành chính)

Hệ thống chatbot sử dụng RAG (Retrieval-Augmented Generation) với các mô hình Qwen2.5 hoạt động 100% offline.

### Yêu cầu hệ thống cho Chatbot

- **RAM:** Tối thiểu 16GB (để chạy Qwen2.5-7B-Instruct)
- **Dung lượng ổ cứng:** ~15GB (cho models)
- **GPU:** Tùy chọn (hỗ trợ CUDA để tăng tốc)

### Bước 1: Cài đặt thư viện Python bổ sung

Đảm bảo đã kích hoạt môi trường ảo, sau đó chạy:

```bash
# Kích hoạt môi trường ảo (nếu chưa)
.\conversion_env\Scripts\Activate.ps1  # Windows PowerShell
# hoặc
conversion_env\Scripts\activate.bat    # Windows CMD

# Cài đặt thư viện chatbot
pip install sentence-transformers faiss-cpu python-docx accelerate
```

Hoặc cài đặt từ requirements.txt (đã bao gồm các thư viện trên):

```bash
pip install -r requirements.txt
```

### Bước 2: Tải Embedding Model (Bắt buộc)

Embedding model được sử dụng để tạo vector embeddings cho tài liệu:

```bash
# Cách 1: Sử dụng Python (tự động tải khi chạy lần đầu)
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')"

# Cách 2: Sử dụng huggingface-cli
huggingface-cli download sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
```

**Lưu ý:** Model này có kích thước khoảng 400MB, sẽ tự động tải khi sử dụng lần đầu nếu chưa có.

### Bước 3: Tải LLM Model - Qwen2.5-7B-Instruct (Bắt buộc)

Model ngôn ngữ để sinh câu trả lời:

```bash
# Cách 1: Sử dụng Python (tự động tải khi chạy lần đầu)
python -c "from transformers import AutoTokenizer, AutoModelForCausalLM; AutoTokenizer.from_pretrained('Qwen/Qwen2.5-7B-Instruct', trust_remote_code=True); AutoModelForCausalLM.from_pretrained('Qwen/Qwen2.5-7B-Instruct', trust_remote_code=True)"

# Cách 2: Sử dụng huggingface-cli (khuyến nghị)
huggingface-cli download Qwen/Qwen2.5-7B-Instruct
```

**Lưu ý quan trọng:**
- Model Qwen2.5-7B-Instruct có kích thước khoảng **14GB**
- Cần kết nối internet lần đầu để tải model
- Sau khi tải, có thể sử dụng 100% offline
- Models được lưu tại: `C:\Users\<username>\.cache\huggingface\hub\` (Windows)

### Bước 4: Kiểm tra cài đặt

Kiểm tra models đã tải đúng chưa:

```bash
# Kiểm tra embedding model
python -c "from sentence_transformers import SentenceTransformer; m = SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'); print('Embedding OK')"

# Kiểm tra LLM (Qwen)
python -c "from transformers import AutoTokenizer, AutoModelForCausalLM; AutoTokenizer.from_pretrained('Qwen/Qwen2.5-7B-Instruct', trust_remote_code=True); print('LLM OK')"
```

### Bước 5: Chạy Chatbot

Sau khi đã tải đầy đủ models, chạy hệ thống:

```bash
# Cách 1: Sử dụng script tự động (Windows)
start-chatbot.bat

# Cách 2: Chạy thủ công
# Terminal 1: Backend
.\conversion_env\Scripts\activate
uvicorn api:app --port 8000 --reload

# Terminal 2: Frontend
npm run dev
```

Sau đó truy cập: `http://localhost:3000/chatbot`

### Tính năng Chatbot

- ✅ **Chat không cần file:** Có thể hỏi trực tiếp, LLM sẽ trả lời
- ✅ **RAG với file:** Tải lên PDF/DOCX và đặt câu hỏi về nội dung
- ✅ **100% Offline:** Tất cả xử lý diễn ra trên máy local
- ✅ **Hỗ trợ tiếng Việt:** Models đã được tối ưu cho tiếng Việt

### Troubleshooting Chatbot

#### Lỗi: "Models not found" hoặc "Embedding model not loaded"
- Đảm bảo đã tải models theo hướng dẫn trên
- Kiểm tra kết nối internet lần đầu (để tải models)
- Chạy lại các lệnh kiểm tra ở Bước 4 (phần Kiểm tra cài đặt) để xác nhận models

#### Lỗi: "Out of memory" khi load model
- Đảm bảo có đủ RAM (tối thiểu 16GB)
- Nếu không đủ RAM, có thể sử dụng model nhỏ hơn:
  ```bash
  huggingface-cli download Qwen/Qwen2.5-1.5B-Instruct
  ```
  Sau đó sửa trong `api.py`: thay `Qwen/Qwen2.5-7B-Instruct` thành `Qwen/Qwen2.5-1.5B-Instruct`

#### Lỗi: "ModuleNotFoundError: No module named 'sentence_transformers'"
- Chạy: `pip install sentence-transformers faiss-cpu python-docx accelerate`
- Đảm bảo đã kích hoạt môi trường ảo

#### Performance chậm
- Sử dụng GPU (CUDA) nếu có - hệ thống sẽ tự động phát hiện
- Giảm số lượng chunks xử lý cùng lúc trong code
- Sử dụng model nhỏ hơn cho embedding

#### Model không tự động tải
- Kiểm tra kết nối internet lần đầu
- Tải thủ công bằng huggingface-cli (xem Bước 2 và 3)
- Kiểm tra quyền ghi vào thư mục cache: `C:\Users\<username>\.cache\huggingface\hub\`

## 📝 Lưu ý quan trọng

1. **Luôn kích hoạt môi trường ảo** trước khi chạy backend
2. **Không đóng terminal** khi ứng dụng đang chạy
3. **File upload** sẽ được lưu trong thư mục `uploads/`
4. **Kết quả chuyển đổi** sẽ được tải về tự động sau khi hoàn thành
5. **Chatbot models** cần được tải riêng (xem phần Hướng dẫn Chatbot ở trên)


## Nếu gặp vấn đề, vui lòng kiểm tra:
1. Đã cài đầy đủ Python và Node.js chưa?
2. Đã kích hoạt môi trường ảo chưa?
3. Đã cài đầy đủ thư viện chưa?
4. Port 3000 và 8000 có đang bị chiếm dụng không?
5. **Đối với Chatbot:** Đã tải đầy đủ models chưa? (xem phần Hướng dẫn Chatbot)
