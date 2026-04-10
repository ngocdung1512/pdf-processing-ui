# Huong dan cai dat may moi (A-Z, ban moi nhat)

Tai lieu nay duoc viet de "lam 1 lan la chay duoc", danh cho may moi hoan toan.
Chi can lam dung thu tu tu tren xuong duoi.

---

## 0) Ket qua mong muon sau khi cai xong

- Frontend chay duoc: `http://localhost:3000`
- OCR backend chay duoc: `http://localhost:8000`
- Chatbot UI AnythingLLM (tuy chon) chay duoc: `http://localhost:3002`
- PDF bridge cho chatbot (tuy chon) health OK: `http://127.0.0.1:8001/health`
- OCR nang cao dung duoc Qwen local + DocLayout-YOLO

---

## 1) Cai phan mem nen tang (lam 1 lan/may)

### 1.1 Git + Git LFS (bat buoc)

```powershell
git --version
git lfs version
git lfs install
```

Neu chua co:
- Git: [https://git-scm.com/download/win](https://git-scm.com/download/win)
- Git LFS: [https://git-lfs.com/](https://git-lfs.com/)

### 1.2 Python 3.11+ (khuyen nghi 3.11)

```powershell
python --version
pip --version
```

Neu khong nhan `python`, thu:

```powershell
py --version
```

### 1.3 Node.js 18+ (LTS)

```powershell
node --version
npm --version
```

### 1.4 Ollama (khuyen dung cho chatbot local)

```powershell
ollama --version
```

---

## 2) Clone repo dung cach (de du file model)

> Vi du dung thu muc `D:\work`, ban co the doi duong dan.

```powershell
cd D:\work
git clone https://github.com/ngocdung1512/pdf-processing-ui.git
cd pdf-processing-ui
```

Kiem tra nhanh file quan trong:

```powershell
dir .\doclayout_yolo_docstructbench_imgsz1024.pt
```

Neu thieu file lon sau khi clone, thu lai quy trinh `git lfs install` roi clone lai.

---

## 3) Tao venv Python va cai dependency (phan quan trong nhat)

### 3.1 Tao + kich hoat venv goc

```powershell
python -m venv conversion_env
.\conversion_env\Scripts\Activate.ps1
```

Neu PowerShell chan script:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 3.2 Cai PyTorch dung theo GPU/CPU (bat buoc theo trang thai hien tai)

Chay trong `conversion_env`:

#### Truong hop A - NVIDIA RTX 50 series (5060/5070, sm_120)

```powershell
pip uninstall torch torchvision torchaudio -y
pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128
```

#### Truong hop B - NVIDIA RTX 30/40 (hoac GPU NVIDIA khac)

```powershell
pip uninstall torch torchvision torchaudio -y
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

#### Truong hop C - CPU only

Bo qua buoc cai torch rieng, cai thang requirements.

### 3.3 Cai thu vien Python goc

```powershell
pip install --upgrade pip
pip install -r requirements.txt
```

---

## 4) Cai DocLayout-YOLO (can cho OCR nang cao scan)

Tu root repo `pdf-processing-ui`:

```powershell
git clone https://github.com/naver-ai/doclayout.git DocLayout-YOLO
pip install -e .\DocLayout-YOLO
```

> Neu da co thu muc `DocLayout-YOLO` thi bo qua clone, chi can `pip install -e`.

---

## 5) Cai frontend + chatbot stack

### 5.1 Frontend

Mo terminal moi tai root project (khong can kich hoat Python):

```powershell
cd D:\work\pdf-processing-ui
npm install
```

### 5.2 Chatbot (AnythingLLM) - tuy chon nhung nen cai

```powershell
npm install -g yarn
npm run chatbot:setup
```

---

## 6) Model can co tren may moi

### 6.1 OCR model

- Uu tien su dung local model tai root: `Qwen2.5-VL-3B`
- Neu chua co, co the tai tu HF:

```powershell
pip install -U "huggingface_hub[cli]"
huggingface-cli download Qwen/Qwen2.5-VL-3B-Instruct --local-dir Qwen2.5-VL-3B
```

### 6.2 YOLO model

- Can file: `doclayout_yolo_docstructbench_imgsz1024.pt` (dat o root)

### 6.3 Chat model cho AnythingLLM

Neu dung Ollama:

```powershell
ollama pull qwen2.5:7b
ollama list
```

---

## 7) Chay he thong

### Cach de nhat

```powershell
cd D:\work\pdf-processing-ui
.\start-dev.bat
```

Script nay se mo backend + frontend (+ chatbot core neu da setup).

### URL can test

- Frontend: `http://localhost:3000`
- OCR API docs: `http://localhost:8000/docs`
- Chatbot: `http://localhost:3002`
- PDF bridge health: `http://127.0.0.1:8001/health`

---

## 8) Checklist verify sau cai (de chac chan "hoan chinh")

Trong root project:

```powershell
# Python env
.\conversion_env\Scripts\python.exe --version
.\conversion_env\Scripts\python.exe -c "import torch; print(torch.__version__)"

# OCR related
.\conversion_env\Scripts\python.exe -c "import fitz,cv2,docx,paddleocr,transformers; print('python deps ok')"

# Frontend
node --version
npm --version
```

Neu muon warm-up model phu:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\download-missing-models.ps1
```

---

## 9) Prompt mau de dua cho Cursor Agent (copy/paste)

Su dung prompt duoi day o may moi de agent tu kiem tra va cai dat theo tai lieu nay:

```text
Hay mo file docs/HUONG_DAN_CAI_DAT_MAY_MOI.md va thuc hien dung tung buoc tu tren xuong duoi de cai dat full tren may moi.

Yeu cau:
1) Kiem tra toolchain truoc (git, git lfs, python, node, npm, ollama).
2) Tao/kich hoat conversion_env.
3) Chon dung nhanh cai PyTorch:
   - RTX 50 (5060/5070): nightly cu128.
   - RTX 30/40: cu124 stable.
   - CPU only: bo qua cai torch rieng.
4) Cai pip install -r requirements.txt o root.
5) Dam bao DocLayout-YOLO duoc cai editable.
6) Cai npm install va npm run chatbot:setup.
7) Kiem tra model/weight quan trong (Qwen2.5-VL-3B, doclayout_yolo_docstructbench_imgsz1024.pt).
8) Chay start-dev.bat.
9) Bao cao ket qua theo checklist URL:
   - http://localhost:3000
   - http://localhost:8000/docs
   - http://localhost:3002
   - http://127.0.0.1:8001/health

Neu buoc nao loi, tu sua va chay lai den khi dat day du 4 URL tren.
```

---

## 10) Loi thuong gap va cach xu ly nhanh

| Hien tuong | Nguyen nhan thuong gap | Cach xu ly nhanh |
|---|---|---|
| `Activate.ps1` bi chan | PowerShell policy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Thieu model YOLO | Clone/LFS chua du | Kiem tra `git lfs install`, clone lai neu can |
| OCR nang cao bao thieu Qwen | Chua co `Qwen2.5-VL-3B` | Tai model ve root hoac truyen path model |
| `Workspace Chat model` trong | Ollama chua keo model/chua chay | `ollama pull qwen2.5:7b`, reload UI |
| Loi VRAM khi OCR | GPU yeu hoac bitsandbytes khong on dinh | Tat 4-bit (`PDF_PIPELINE_OCR_LOAD_4BIT=false`) |

---

## 11) Tai lieu lien quan

- Tong quan du an: `README.md`
- Danh sach model: `docs/MODELS_TO_DOWNLOAD.md`
- Chatbot setup chi tiet: `OCR_LLM/CHATBOT_SETUP.md`
- PDF service stack: `services/pdf_processing/README.md`

---

## 12) Prompt cuc ngan (1 doan de dung ngay)

Neu ban muon prompt ngan gon de dan vao Cursor Agent o may moi, dung doan nay:

```text
Doc va lam dung theo docs/HUONG_DAN_CAI_DAT_MAY_MOI.md de cai dat full project tren may moi. Tu dong kiem tra toolchain (git/git-lfs/python/node/npm/ollama), tao conversion_env, cai PyTorch dung nhanh theo GPU (RTX 50 -> cu128 nightly, RTX 30/40 -> cu124, CPU-only -> skip torch rieng), pip install -r requirements.txt, cai DocLayout-YOLO editable, npm install, npm run chatbot:setup, kiem tra model Qwen2.5-VL-3B + doclayout_yolo_docstructbench_imgsz1024.pt, chay start-dev.bat, va chi bao hoan tat khi 4 URL sau deu OK: http://localhost:3000, http://localhost:8000/docs, http://localhost:3002, http://127.0.0.1:8001/health. Neu loi thi tu sua va chay lai den khi dat.
```
