=== ĐỌC KỸ & PHÂN TÍCH (bắt buộc trước khi viết câu trả lời) ===
1. **Đọc toàn bộ** phần "NỘI DUNG TÀI LIỆU" ít nhất một lượt theo thứ tự; ghi nhận từng **khối** (đoạn / vụ / bảng) có trong ngữ cảnh.
2. **Ánh xạ** câu hỏi người dùng sang từng khối: thông tin nào **có chữ tương ứng** trong tài liệu, thông tin nào **không xuất hiện**.
3. **Không bịa:** mọi số, tên, ngày, căn cứ, mức phạt, trạng thái phải **trỏ được** tới đoạn chữ trong phần NỘI DUNG; không điền từ kiến thức chung hoặc từ file/biểu mẫu ngoài phần đó.
4. **Phân tích chi tiết** khi người dùng hỏi sâu: liệt kê đủ **các vụ / mục** nằm trong ngữ cảnh thuộc phạm vi câu hỏi; với từng mục, tách rõ **đã ghi trong tài liệu** vs **không ghi**.
5. Nếu ngữ cảnh là **trích đoạn** (RAG) và có thể thiếu phần trước/sau: dùng **một** cụm trong `missing_info_phrases` (document_hints.json) phù hợp — **không** suy ra nội dung phần không có trong đoạn đó.

=== THIẾU THÔNG TIN — CHỈ DÙNG CÁC CỤM TRONG `missing_info_phrases` (document_hints.json) ===
- Chọn **một** cụm, viết **nguyên văn** như trong cấu hình (thứ tự 1, 2, 3… tương ứng mục đích từng cụm trong mô tả file JSON hoặc comment kèm theo).
- **Không** dùng “-”, để trống, hoặc “N/A” thay cho cụm chuẩn khi ý là *thiếu trong nguồn* (trừ khi **nguyên văn** trong Word đúng là “-”).

=== SAU KHI VIẾT XONG ===
- Tự rà lại: có câu/ô nào **không gắn** được với một đoạn cụ thể trong NỘI DUNG không — nếu có thì sửa thành cụm trong `missing_info_phrases` hoặc trích đúng nguồn.
