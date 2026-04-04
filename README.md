Web chat hỏi–đáp văn bản pháp lý tiếng Việt theo hướng **RAG + LLM**.

- Dữ liệu nguồn: `../Data/top5_documents.csv` (mỗi dòng ~ 1 Điều)
- Retrieval: **SQLite FTS5 (BM25)**
- Generation: **Gemini** (khuyến nghị) hoặc **OpenAI** (tuỳ chọn)

## Getting Started

### 1) Install

```bash
npm install
```

### 2) Build RAG index (bắt buộc)

Script sẽ đọc CSV và tạo `.rag/rag.db` để truy vấn nhanh.

```bash
npm run build:index
```

#### Slim mode (nhẹ hơn, khuyến nghị nếu máy yếu / deploy dễ crash)

Bạn có thể giảm kích thước DB bằng cách:

- **Lấy ~50% dữ liệu** (deterministic sampling)
- **Cắt ngắn `content`** khi index (giảm dung lượng + tăng tốc)

PowerShell (Windows):

```powershell
$env:RAG_SAMPLE_EVERY=2
$env:RAG_MAX_CONTENT_CHARS=2000
npm run build:index
```

### 3) Configure LLM (tuỳ chọn)

Tạo file `.env.local` trong thư mục `webchat-rag/`:

```bash
# KHÔNG chia sẻ/commit API key.

# Gemini (khuyến nghị)
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-1.5-flash

# Giới hạn độ dài context gửi lên LLM (giảm lag/đứng hình)
RAG_CONTEXT_CHARS_PER_DOC=1500

# Hoặc OpenAI (tuỳ chọn)
# OPENAI_API_KEY=...
# OPENAI_MODEL=gpt-4o-mini
```

Nếu không có `GEMINI_API_KEY` hoặc `OPENAI_API_KEY`, app vẫn chạy và sẽ trả về các điều khoản truy hồi được (không tổng hợp bằng LLM).

### 4) Run dev server

First, run the development server:

```bash
npm run dev
```

Open http://localhost:3000 để dùng web chat.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Notes

- Nếu bạn thay đổi `Data/top5_documents.csv`, hãy chạy lại `npm run build:index`.
- API chat nằm ở `src/app/api/chat/route.ts`.
