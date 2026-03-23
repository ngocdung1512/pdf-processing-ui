# Models to download on new machine (terminal only)

Mỗi mục chỉ có 1 cách cài bằng lệnh terminal.

---

## 1) Pull 4 chatbot models (Ollama from Hugging Face)

### Bước 1: Tạo thư mục chứa model trên máy mới (ví dụ ổ D)

```powershell
New-Item -ItemType Directory -Force -Path "D:\ollama\models" | Out-Null
```

### Bước 2: Trỏ Ollama về thư mục đó

```powershell
setx OLLAMA_MODELS "D:\ollama\models"
```

Sau khi chạy `setx`, đóng Ollama và mở lại (hoặc restart máy) để biến môi trường có hiệu lực.

### Bước 3: Pull 4 model

Chạy 1 lệnh:

```powershell
ollama pull hf.co/lytch/qwen:qwen3:8b; ollama pull hf.co/lytch/qwen:qwen3:30b; ollama pull hf.co/lytch/qwen:qwen3.5:9b; ollama pull hf.co/lytch/qwen:qwen3-embedding:8b
```

### Bước 4: Xác nhận model đã nằm đúng nơi

```powershell
ollama list; Get-ChildItem "D:\ollama\models"
```

Ghi chú: với cách này, model chatbot sẽ nằm trong thư mục `D:\ollama\models` trên máy mới.

---

## 2) Download OCR model `Qwen2.5-VL-3B` (chỉ chạy khi máy mới chưa có)

```powershell
python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen2.5-VL-3B-Instruct', local_dir='Qwen2.5-VL-3B')"
```

---

## 3) Download VietOCR weight `vgg_transformer.pth` (optional)

```powershell
Invoke-WebRequest -Uri "https://vocr.vn/data/vietocr/vgg_transformer.pth" -OutFile ".\vgg_transformer.pth"
```

---

## 4) Verify chatbot models

```powershell
ollama list
```
