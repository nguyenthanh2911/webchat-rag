# Webchat RAG cho văn bản pháp lý (Tiếng Việt)

Ứng dụng web chat hỏi–đáp văn bản pháp lý tiếng Việt theo hướng **RAG + LLM**.
Hệ thống ưu tiên trả lời dựa trên các điều khoản truy hồi (có trích dẫn “Căn cứ”), nhằm tăng tính kiểm chứng và giảm trả lời suy diễn.

## 1) Giới thiệu đề tài

Trong bối cảnh người dùng cần tra cứu nhanh nội dung văn bản pháp lý, việc dùng LLM thuần dễ gặp vấn đề “bịa” hoặc trả lời không có căn cứ.
Project này áp dụng **Retrieval-Augmented Generation (RAG)**: trước khi sinh câu trả lời, hệ thống truy hồi các điều khoản liên quan từ tập dữ liệu, sau đó (tuỳ chọn) dùng LLM để tổng hợp câu trả lời dựa trên context truy hồi.

Mục tiêu chính:

- Trả lời **ngắn gọn, chính xác** dựa trên dữ liệu truy hồi.
- Luôn kèm mục **Căn cứ** (Điều/Chương) để người dùng kiểm tra lại.
- Có thể chạy ở chế độ **không cần API key** (retrieval-only).

## 2) Phạm vi và tính năng hiện có

- **Dataset**: `data/vbpl_crawl_final.csv` (mỗi dòng xấp xỉ 1 Điều).
- **Retrieval**: SQLite **FTS5 + BM25**, có rerank nhẹ cho một số ý định pháp lý phổ biến.
- **Generation** (tuỳ chọn):
  - Gemini (khuyến nghị, nếu có `GEMINI_API_KEY`)
  - OpenAI (tuỳ chọn, nếu có `OPENAI_API_KEY`)
- **UI**: web chat tối giản, hiển thị hội thoại + “Căn cứ” (tối đa 3 trích dẫn) + trạng thái `usedLLM`.

## 3) Công nghệ sử dụng

- Web: Next.js (App Router), React, TypeScript
- UI: TailwindCSS
- Index/Retrieval: `better-sqlite3` (SQLite FTS5/BM25)
- Parse CSV: `csv-parse`
- LLM SDK: `@google/generative-ai`, `openai`
- Validation: `zod`

## 4) Kiến trúc / Pipeline

Luồng xử lý tổng quát:

```
data/vbpl_crawl_final.csv
  │
  ▼
scripts/build-index.ts  --(npm run build:index)-->  .rag/rag.db (SQLite FTS5)
                                                        │
                                                        ▼
UI (src/app/page.tsx) --POST /api/chat--> API (src/app/api/chat/route.ts)
                                              │
                                              ▼
                                      retrieve(question, k)
                                              │
                   ┌──────────────────────────┴──────────────────────────┐
                   │                                                     │
                   ▼                                                     ▼
         answerWithRag() (Gemini/OpenAI)                       Fallback (no key)
                   │                                                     │
                   └──────────────────────────┬──────────────────────────┘
                                              ▼
                               JSON: { answer, citations, usedLLM }
```

Ghi chú theo code:

- `retrieve()` xây dựng truy vấn FTS từ câu hỏi (chuẩn hoá, tokenize, lọc stopword), lấy tập ứng viên rộng hơn rồi rerank nhẹ.
- `answerWithRag()` ưu tiên Gemini nếu có key, sau đó fallback OpenAI; nếu không có key sẽ trả về retrieval-only.

## 5) Dữ liệu và artifacts

- File nguồn: `data/vbpl_crawl_final.csv`.
- Output build index:
  - `.rag/rag.db`: SQLite FTS index
  - `.rag/meta.json`: metadata (thời điểm build, số dòng, tuỳ chọn sampling/truncate)

## 6) Hướng dẫn triển khai (local)

### Yêu cầu

- Node.js (khuyến nghị bản LTS)
- (Windows) `better-sqlite3` là native module: có thể cần build tools nếu máy thiếu môi trường compile.

### Bước 1: Cài dependencies

```bash
npm install
```

### Bước 2: Build RAG index (bắt buộc)

```bash
npm run build:index
```

Lệnh này đọc CSV và tạo `.rag/rag.db`. Nếu bạn thay đổi dataset, hãy chạy lại lệnh.

### Bước 3: Cấu hình LLM (tuỳ chọn)

Tạo `.env.local` ở thư mục gốc project (không commit API key):

```bash
# KHÔNG chia sẻ/commit API key.

# Gemini (khuyến nghị)
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash

# Giới hạn độ dài context gửi lên LLM (giảm latency/cost)
RAG_CONTEXT_CHARS_PER_DOC=1500

# Hoặc OpenAI (tuỳ chọn)
# OPENAI_API_KEY=...
# OPENAI_MODEL=gpt-4o-mini
```

Nếu không có `GEMINI_API_KEY` hoặc `OPENAI_API_KEY`, app vẫn chạy và chỉ trả về các điều khoản truy hồi được.

### Bước 4: Chạy dev server

```bash
npm run dev
```

Mở: http://localhost:3000

## 7) API

### POST `/api/chat`

Request body:

```json
{
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

Response (thành công):

```json
{
  "answer": "...",
  "citations": [
    {
      "id": "...",
      "name": "...",
      "chapter_name": "...",
      "article": "...",
      "quote": "...",
      "ref": "...",
      "score": -12.3
    }
  ],
  "usedLLM": true
}
```

Response (lỗi):

```json
{ "error": "..." }
```

## 8) Scripts

- `npm run build:index`: tạo `.rag/rag.db` từ CSV
- `npm run dev`: chạy local dev server
- `npm run build`: build production
- `npm run start`: chạy production server sau khi build
- `npm run lint`: eslint

## 9) Tuỳ chọn build index (giảm dung lượng / tăng tốc)

`scripts/build-index.ts` hỗ trợ một số biến môi trường (tuỳ chọn):

- `RAG_SAMPLE_EVERY=2`: lấy mẫu ~50% dòng (deterministic theo hash `ref`)
- `RAG_MAX_CONTENT_CHARS=2000`: truncate nội dung mỗi điều

Ví dụ (PowerShell):

```powershell
$env:RAG_SAMPLE_EVERY=2
$env:RAG_MAX_CONTENT_CHARS=2000
npm run build:index
```

## 10) Troubleshooting

- Lỗi “RAG DB not found … .rag/rag.db”:
  - Chạy `npm run build:index` trước khi chạy app.
- `usedLLM=false` và chỉ thấy “Căn cứ”:
  - Kiểm tra `.env.local` đã có `GEMINI_API_KEY` hoặc `OPENAI_API_KEY`.
- Cài đặt `better-sqlite3` lỗi (Windows):
  - Đảm bảo có môi trường build phù hợp cho native module; khi cần, xoá `node_modules` và chạy lại `npm install`.

## Notes

- API chat nằm ở `src/app/api/chat/route.ts`.
- Thay thế BM25 bằng Vecter Search
