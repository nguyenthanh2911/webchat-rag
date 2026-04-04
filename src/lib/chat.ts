import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Citation, RagDoc } from './rag';

export type ChatResult = {
  answer: string;
  citations: Citation[];
  usedLLM: boolean;
};

function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
}

function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}

function getModel(): string {
  return process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
}

function getGeminiModel(): string {
  // Keep configurable; default chosen for cost/latency.
  return process.env.GEMINI_MODEL?.trim() || 'gemini-1.5-flash';
}

function getContextCharsPerDoc(): number {
  const raw = process.env.RAG_CONTEXT_CHARS_PER_DOC?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  // Keep conservative default to avoid huge prompts.
  return Number.isFinite(n) && n > 200 ? n : 1500;
}

function truncateForContext(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars).trimEnd() + '…';
}

function buildContextBlock(docs: RagDoc[]): string {
  const maxChars = getContextCharsPerDoc();
  return docs
    .map((d, i) => {
      return [
        `[#${i + 1}]`,
        `id: ${d.id}`,
        `name: ${d.name}`,
        `chapter: ${d.chapter_name}`,
        `article: ${d.article}`,
        `content: ${truncateForContext(d.content, maxChars)}`,
      ].join('\n');
    })
    .join('\n\n');
}

function fallbackAnswer(question: string, citations: Citation[]): string {
  if (!citations.length) {
    return (
      `Mình chưa tìm được điều khoản phù hợp trong dữ liệu để trả lời câu hỏi: "${question}". ` +
      'Bạn hãy thử hỏi cụ thể hơn (nêu rõ tên thông tư/nghị định hoặc số điều/chương nếu có).'
    );
  }

  const citeLines = citations
    .slice(0, 3)
    .map((c, idx) => {
      return `${idx + 1}) ${c.id} — ${c.chapter_name} — ${c.article}: ${c.quote}`;
    })
    .join('\n');

  return (
    'Mình chưa được cấu hình LLM (thiếu GEMINI_API_KEY/OPENAI_API_KEY), nên dưới đây là các điều khoản liên quan nhất mình truy hồi được để bạn tham khảo:\n\n' +
    citeLines
  );
}

async function answerWithGemini(params: {
  question: string;
  docs: RagDoc[];
  citations: Citation[];
}): Promise<ChatResult> {
  const { question, docs, citations } = params;

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { answer: fallbackAnswer(question, citations), citations, usedLLM: false };

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = getGeminiModel();

  const system =
    'Bạn là trợ lý pháp lý tiếng Việt. Trả lời NGẮN GỌN và CHÍNH XÁC dựa trên các trích đoạn được cung cấp.\n' +
    'Quy tắc bắt buộc:\n' +
    '- Chỉ sử dụng thông tin trong CONTEXT; không suy diễn nếu không có căn cứ.\n' +
    '- Nếu không đủ căn cứ, hãy nói rõ "không đủ căn cứ trong dữ liệu truy hồi" và gợi ý người dùng hỏi lại cụ thể.\n' +
    '- Luôn kèm mục "Căn cứ" liệt kê 1-3 điều/chương liên quan nhất (id, chương, điều).';

  const user =
    `CÂU HỎI: ${question}\n\n` +
    `CONTEXT (các điều khoản đã truy hồi):\n${buildContextBlock(docs)}\n\n` +
    'Hãy trả lời bằng tiếng Việt theo format:\n' +
    'Trả lời: ...\n' +
    'Căn cứ:\n' +
    '- <id> — <chapter> — <article>\n';

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: system,
  });

  const result = await model.generateContent(user);
  const answer = result.response.text()?.trim();

  if (!answer) {
    return { answer: fallbackAnswer(question, citations), citations, usedLLM: false };
  }

  return { answer, citations, usedLLM: true };
}

export async function answerWithRag(params: {
  question: string;
  docs: RagDoc[];
  citations: Citation[];
}): Promise<ChatResult> {
  const { question, docs, citations } = params;

  // Prefer Gemini if configured (user asked for Gemini). Fallback to OpenAI, else retrieval-only.
  if (hasGeminiKey()) {
    return await answerWithGemini({ question, docs, citations });
  }

  if (!hasOpenAIKey()) {
    return { answer: fallbackAnswer(question, citations), citations, usedLLM: false };
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = getModel();
  const context = buildContextBlock(docs);

  const system =
    'Bạn là trợ lý pháp lý tiếng Việt. Trả lời NGẮN GỌN và CHÍNH XÁC dựa trên các trích đoạn được cung cấp.\n' +
    'Quy tắc bắt buộc:\n' +
    '- Chỉ sử dụng thông tin trong CONTEXT; không suy diễn nếu không có căn cứ.\n' +
    '- Nếu không đủ căn cứ, hãy nói rõ "không đủ căn cứ trong dữ liệu truy hồi" và gợi ý người dùng hỏi lại cụ thể.\n' +
    '- Luôn kèm mục "Căn cứ" liệt kê 1-3 điều/chương liên quan nhất (id, chương, điều).';

  const user =
    `CÂU HỎI: ${question}\n\n` +
    `CONTEXT (các điều khoản đã truy hồi):\n${context}\n\n` +
    'Hãy trả lời bằng tiếng Việt theo format:\n' +
    'Trả lời: ...\n' +
    'Căn cứ:\n' +
    '- <id> — <chapter> — <article>\n';

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const answer = completion.choices[0]?.message?.content?.trim();
  if (!answer) {
    return { answer: fallbackAnswer(question, citations), citations, usedLLM: false };
  }

  return { answer, citations, usedLLM: true };
}
