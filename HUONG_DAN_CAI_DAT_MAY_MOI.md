# Hướng dẫn cài đặt từ đầu trên máy mới (sau khi Git clone)

Tài liệu này hướng dẫn **từng bước** từ lúc clone repo đến khi chạy được ứng dụng PDF to DOCX trên một máy tính mới.

---

## Cần tải model gì về máy mới?

| Chức năng | Model | Cách có trên máy mới |
|-----------|--------|------------------------|
| **PDF → DOCX (Layout + OCR)** | `doclayout_yolo_docstructbench_imgsz1024.pt` | **Đi kèm repo** — clone có Git LFS là có file (không cần tải thêm). |
| **PDF → DOCX chế độ OCR (AI)** | **Qwen2.5-VL** (vd: Qwen2.5-VL-3B) | **Cần tải thủ công** — không có trong repo. Tải từ Hugging Face, đặt vào thư mục gốc project (vd: `Qwen2.5-VL-3B`) hoặc chỉ đường dẫn khi chạy. |


---

## Phần 1: Chuẩn bị (chỉ làm 1 lần trên máy)

### 1.1. Cài Git (nếu chưa có)

- Tải: https://git-scm.com/download/win  
- Cài xong, mở **PowerShell** hoặc **Command Prompt** (CMD), kiểm tra:

```powershell
git --version
```

### 1.2. Cài Python 3.11+

- Tải: https://www.python.org/downloads/  
- Khi cài, **bật** “Add Python to PATH”.  
- Kiểm tra:

```powershell
python --version
```

Nếu lệnh không nhận, thử:

```powershell
py --version
```

### 1.3. Cài Node.js 18+

- Tải: https://nodejs.org/ (bản LTS).  
- Kiểm tra:

```powershell
node --version
npm --version
```

### 1.4. Cài Git LFS (để tải file model .pt khi clone)

Repo dùng Git LFS cho file model. Trên máy mới cần cài LFS rồi mới clone thì file `.pt` mới tải đủ.

- Tải: https://git-lfs.com/ (chọn Windows, cài đặt).  
- Mở lại PowerShell/CMD, chạy **1 lần**:

```powershell
git lfs install
```

---

## Phần 2: Clone project và cài đặt

### Bước 1: Mở terminal và clone repo

**Lưu ý:** Đảm bảo đã cài **Git LFS** (Phần 1.4) và chạy `git lfs install` trước khi clone, để file model `.pt` được tải xuống.

Mở **PowerShell** (hoặc CMD), chọn thư mục muốn đặt project (ví dụ Desktop):

```powershell
cd $env:USERPROFILE\Desktop
```

Clone project:

```powershell
git clone https://github.com/ngocdung1512/pdf-processing-ui.git
cd pdf-processing-ui
```

Sau khi clone xong, trong thư mục sẽ có sẵn file `doclayout_yolo_docstructbench_imgsz1024.pt` (nhờ Git LFS). Kiểm tra:

```powershell
dir
```

Phải thấy: `package.json`, `requirements.txt`, `api.py`, và `doclayout_yolo_docstructbench_imgsz1024.pt`.

---

### Bước 2: Tạo môi trường ảo Python

Trong thư mục `pdf-processing-ui`:

**PowerShell:**

```powershell
python -m venv conversion_env
.\conversion_env\Scripts\Activate.ps1
```

Nếu PowerShell báo lỗi về execution policy:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Rồi chạy lại:

```powershell
.\conversion_env\Scripts\Activate.ps1
```

**CMD (Command Prompt):**

```cmd
python -m venv conversion_env
conversion_env\Scripts\activate.bat
```

Khi thành công, đầu dòng lệnh sẽ có `(conversion_env)`.

---

### Bước 3: Cài thư viện Python

Vẫn trong cùng cửa sổ (đã kích hoạt `conversion_env`):

```powershell
pip install --upgrade pip
pip install -r requirements.txt
```

- Lần đầu có thể mất **10–30 phút** tùy mạng.  
- Nếu báo lỗi với PyTorch/CUDA, có thể cài PyTorch phù hợp với máy trước, rồi chạy lại `pip install -r requirements.txt`.

---

### Bước 4: Cài thư viện Node.js (frontend)

Mở **một cửa sổ terminal mới**, vào đúng thư mục project (không bắt buộc bật venv):

```powershell
cd $env:USERPROFILE\Desktop\pdf-processing-ui
npm install
```

Chờ cài xong.

---

### Bước 5: Chạy ứng dụng

Vẫn trong thư mục `pdf-processing-ui`.

**Cách 1 – Double-click (dễ nhất):**

- Mở File Explorer, vào thư mục `pdf-processing-ui`.
- Double-click file **`start-dev.bat`**.  
- Sẽ mở 2 cửa sổ (backend + frontend) và có thể tự mở trình duyệt.

**Cách 2 – Chạy từ terminal:**

**PowerShell:**

```powershell
cd $env:USERPROFILE\Desktop\pdf-processing-ui
.\start-dev.ps1
```

**CMD:**

```powershell
cd %USERPROFILE%\Desktop\pdf-processing-ui
start-dev.bat
```

Sau khi chạy:

- **Giao diện web:** mở trình duyệt vào **http://localhost:3000**  
- **API backend:** chạy tại http://localhost:8000  

Nếu trình duyệt không tự mở, bạn tự vào: **http://localhost:3000**

---

## Phần 3: Chỉ dùng chế độ Layout (PDF văn bản)

Nếu bạn **chỉ cần chế độ Layout** (PDF văn bản → DOCX, không dùng OCR/AI), làm đủ **Phần 1 + Phần 2** là đủ. Không cần Phần 4.

---

## Phần 4: Bật thêm chế độ OCR (AI) – tùy chọn

Chế độ OCR (AI) cần thư viện **DocLayout-YOLO**. File model **`doclayout_yolo_docstructbench_imgsz1024.pt`** đã có trong repo (tải qua Git LFS khi clone), không cần tải thêm.

Chỉ làm phần này nếu bạn cần chuyển PDF scan / ảnh sang DOCX bằng AI.

### 4.1. Clone DocLayout-YOLO vào trong project

Trong thư mục gốc `pdf-processing-ui`, mở PowerShell (có thể tắt venv):

```powershell
cd $env:USERPROFILE\Desktop\pdf-processing-ui
git clone https://github.com/naver-ai/doclayout.git DocLayout-YOLO
```

(Nếu repo thực tế bạn dùng khác URL/ tên, hãy đổi cho đúng.)

### 4.2. Cài package DocLayout-YOLO ở chế độ editable

Bật lại môi trường ảo rồi cài:

```powershell
.\conversion_env\Scripts\Activate.ps1
pip install -e ./DocLayout-YOLO
```

Sau khi làm xong 4.1–4.2, chạy lại ứng dụng như **Bước 5** ở trên; chế độ OCR (AI) sẽ dùng được (file .pt đã có sẵn trong project).

---

## Xử lý lỗi thường gặp

| Lỗi | Cách xử lý |
|-----|------------|
| `python` / `pip` không nhận | Cài lại Python, bật “Add to PATH”; hoặc dùng `py` thay `python`. |
| `git` không nhận | Cài Git và mở lại terminal. |
| Không kích hoạt được venv (PowerShell) | Chạy `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` rồi thử lại. |
| Port 3000 hoặc 8000 đã dùng | Tắt app đang dùng port đó, hoặc đổi port trong lệnh chạy (xem README). |
| `pip install -r requirements.txt` lỗi | Chạy `pip install --upgrade pip` rồi cài lại; nếu lỗi PyTorch thì cài đúng phiên bản PyTorch cho máy (CPU/CUDA). |
| Trình duyệt không mở | Tự mở và vào **http://localhost:3000**. |
| Clone xong không thấy file .pt | Cài Git LFS (1.4), chạy `git lfs install`, xóa thư mục project và clone lại. |

---

## Tóm tắt nhanh (đã có Python + Node + Git + Git LFS)

```powershell
# Đảm bảo đã: git lfs install
cd $env:USERPROFILE\Desktop
git clone https://github.com/ngocdung1512/pdf-processing-ui.git
cd pdf-processing-ui

python -m venv conversion_env
.\conversion_env\Scripts\Activate.ps1
pip install -r requirements.txt

# Mở terminal mới, không cần venv:
cd $env:USERPROFILE\Desktop\pdf-processing-ui
npm install

# Chạy (từ thư mục pdf-processing-ui):
.\start-dev.bat
```

Sau đó mở **http://localhost:3000** trong trình duyệt.
