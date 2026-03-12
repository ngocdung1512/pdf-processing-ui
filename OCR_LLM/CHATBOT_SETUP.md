# Chatbot (AnythingLLM) - Cài đặt và mở

Theo cách setup gốc của project: chatbot chạy tại **http://localhost:3002**, cần **3 tiến trình** (Server 4101, Collector 8888, Frontend 3002).

## 1. Cài đặt lần đầu

Từ **thư mục gốc** dự án (`pdf-processing-ui`):

```bash
npm run chatbot:setup
```

*(Cần Yarn: `npm install -g yarn` nếu chưa có.)*

Hoặc vào OCR_LLM rồi chạy:

```bash
cd OCR_LLM
yarn setup
```

Sau đó tạo file **OCR_LLM/frontend/.env** với nội dung:

```
VITE_API_BASE=http://localhost:4101/api
```

## 2. Cách mở chatbot (đã cài xong)

**Cách “giống code gốc” – 1 cửa sổ (Server + Collector + Frontend cùng terminal):**

Code gốc AnythingLLM dùng `yarn dev:all` (cả 3 tiến trình trong một terminal), nên Collector luôn chạy và kéo thả file luôn bật. Trong project này có thể chạy tương tự:

```bat
scripts\startup\start-chatbot-one-window.bat
```

Hoặc từ thư mục gốc: `cd OCR_LLM`, set `SERVER_PORT=4101`, rồi `yarn dev:all`. Chỉ cần **một** cửa sổ CMD; đợi vài giây rồi mở **http://localhost:3002**. Không đóng cửa sổ đó.

**Cách A – Chạy cả app (Backend + Frontend + Chatbot):**

Từ thư mục gốc:

```bat
.\start-dev.bat
```

Sẽ mở **3 cửa sổ CMD** (Backend 8000, Frontend 3000, Chatbot — trong đó Chatbot là 1 cửa sổ chạy đủ Server 4101 + Collector 8888 + Frontend 3002). Giữ cả 3 mở. Trình duyệt mở http://localhost:3000. Để dùng chatbot: bấm **"Mở trợ lý chatbot"** hoặc mở **http://localhost:3002**. Kéo thả file trong chatbot hoạt động bình thường.

**Cách B – Chỉ chạy chatbot (1 cửa sổ, mặc định):**

Từ thư mục gốc:

```bat
.\start-chatbot.bat
```

Hoặc:

```bat
.\scripts\startup\start-chatbot-core.bat
```

Sẽ mở **một** cửa sổ CMD chạy đủ Server 4101, Collector 8888, Frontend 3002 (giống code gốc `yarn dev:all`). Đợi vài giây rồi mở **http://localhost:3002**. Giữ cửa sổ đó mở — kéo thả file hoạt động bình thường.

## 3. Nếu trang 3002 trắng hoặc không kết nối được

- Đảm bảo **đủ 3 cửa sổ** chatbot đang chạy và không đóng.
- Cửa sổ **"Chatbot Server - 4101"** (hoặc "AnythingLLM Server - 4101") phải in dòng **"listening on port 4101"**.
- Kiểm tra port: chạy `scripts\check-chatbot-ports.bat` (xem 4101, 3002 có LISTENING không).
- Nếu Server đóng ngay hoặc báo lỗi: trong thư mục `OCR_LLM` chạy tay `set SERVER_PORT=4101 && yarn dev:server` (CMD) hoặc `$env:SERVER_PORT=4101; yarn dev:server` (PowerShell) để xem log lỗi.

## 4. Sau khi cập nhật code chatbot

Sau khi pull code hoặc sửa frontend (ví dụ sửa logo, DnD, API), trình duyệt có thể vẫn chạy bản cũ do cache Vite hoặc cache trình duyệt.

**Cách áp dụng bản mới:**

1. **Tắt hết và chạy lại kèm xóa cache (khuyên dùng):**
   ```bat
   scripts\startup\start-chatbot-clean.bat
   ```
   Script sẽ: tắt process 4101/8888/3002 → xóa cache Vite (`frontend/node_modules/.vite`) → mở lại 3 cửa sổ (Server, Collector, Frontend).

2. **Trình duyệt:** Mở http://localhost:3002 rồi **Hard refresh:** `Ctrl + Shift + R` (hoặc F12 → chuột phải nút Reload → Empty Cache and Hard Reload).

**Ghi chú trong code dự án:**

- **Logo:** Khi server/logo chưa sẵn sàng, frontend không còn ném lỗi đỏ "Failed to fetch logo!"; dùng logo mặc định (xem `OCR_LLM/frontend/src/models/system.js`, `LogoContext.jsx`).
- **Kéo thả file:** Cần **Collector (8888)** chạy thì mới bật. Nếu chưa chạy, banner vàng sẽ báo "Document processor (Collector) chưa kết nối" và kéo thả bị khóa — giữ cửa sổ Collector mở hoặc chạy lại bằng script trên.

## 5. Kéo thả file không được – nguyên nhân và cách xử lý

**So với code gốc (Mintplex-Labs/anything-llm):** Logic giống hệt: frontend gọi `checkDocumentProcessorOnline()` (API `/system/document-processing-status`), server kiểm tra Collector (8888); nếu Collector không chạy thì trả 503 và frontend đặt `disabled: !ready` cho dropzone. Code gốc cũng vậy — khi Collector offline thì kéo thả bị tắt. Ở bản gốc thường chạy `yarn dev:all` (một terminal, đủ 3 process) nên Collector luôn chạy và kéo thả luôn hoạt động. Ở project này nếu chạy 3 cửa sổ riêng mà tắt nhầm Collector thì kéo thả sẽ khóa; dùng **1 cửa sổ** (`start-chatbot-one-window.bat`) thì hành vi giống code gốc.

**Luồng hoạt động (để chẩn đoán):**

1. **Frontend (3002)** khi mở trang chat gọi API: `GET http://localhost:4101/api/system/document-processing-status`.
2. **Server (4101)** nhận request, gọi **Collector** qua `http://0.0.0.0:8888` (hoặc `COLLECTOR_PORT` nếu set). Nếu Collector phản hồi 200 → Server trả 200; nếu không kết nối được → Server trả **503**.
3. Frontend: nếu response **200** thì bật kéo thả (`ready = true`), nếu **503** hoặc lỗi mạng thì tắt kéo thả và hiện banner vàng.

**Nguyên nhân thường gặp:**

| Triệu chứng | Nguyên nhân | Cách xử lý |
|-------------|-------------|------------|
| Banner vàng "Collector chưa kết nối", Console 503 `doc-processing-status` | **Collector (8888) chưa chạy** hoặc đã tắt | Mở cửa sổ "Chatbot Collector - 8888" hoặc chạy lại `.\start-dev.bat` / `scripts\startup\start-chatbot-clean.bat`. Trong CMD phải thấy dòng "Document processor app listening on port 8888". |
| Trang 3002 không gọi được API, lỗi CORS / failed to fetch | **Server (4101) chưa chạy** | Đảm bảo cửa sổ "Chatbot Server - 4101" đang chạy và in "listening on port 4101". |
| Đã chạy Collector nhưng vẫn 503 | Port 8888 bị chiếm hoặc Collector crash ngay khi khởi động | Trong `OCR_LLM` chạy tay: `yarn dev:collector` để xem log lỗi. Kiểm tra port: `netstat -an \| findstr 8888`. |

**Trong code (tham chiếu):**

- Frontend kiểm tra: `OCR_LLM/frontend/src/models/system.js` → `checkDocumentProcessorOnline()` (gọi `/system/document-processing-status`).
- UI bật/tắt kéo thả: `OCR_LLM/frontend/src/components/WorkspaceChat/ChatContainer/DnDWrapper/index.jsx` → `ready` từ context, dropzone `disabled: !ready`.
- Server: `OCR_LLM/server/endpoints/system.js` → route `GET /system/document-processing-status` gọi `CollectorApi().online()`.
- Collector: `OCR_LLM/server/utils/collectorApi/index.js` → `online()` gọi `fetch(http://0.0.0.0:8888)`. Collector listen tại `OCR_LLM/collector/index.js` port 8888.
