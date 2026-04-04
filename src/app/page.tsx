"use client";

import { useMemo, useState } from "react";

type Citation = {
  id: string;
  name: string;
  chapter_name: string;
  article: string;
  quote: string;
  ref: string;
  score?: number;
};

type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      citations: Citation[];
      usedLLM: boolean;
    };

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !isLoading, [input, isLoading]);

  async function sendMessage() {
    const question = input.trim();
    if (!question || isLoading) return;

    setError(null);
    setIsLoading(true);
    setInput("");

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const json = (await res.json()) as
        | { answer: string; citations: Citation[]; usedLLM: boolean }
        | { error: string };

      if (!res.ok || "error" in json) {
        throw new Error("error" in json ? json.error : "Request failed");
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: json.answer, citations: json.citations, usedLLM: json.usedLLM },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-foreground/15">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4">
          <h1 className="text-base font-semibold">Legal RAG Chat</h1>
          <div className="text-xs text-foreground/70">
            {isLoading ? "Đang trả lời…" : "RAG + LLM"}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
        <div className="rounded-lg border border-foreground/15 p-3 text-sm text-foreground/80">
          Hỏi về nội dung văn bản pháp lý. Trợ lý sẽ trả lời kèm mục “Căn cứ” theo Điều/Chương.
        </div>

        {error ? (
          <div className="rounded-lg border border-foreground/15 bg-background p-3 text-sm text-foreground">
            <div className="font-medium">Lỗi</div>
            <div className="mt-1 text-foreground/80">{error}</div>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col gap-3">
          {messages.length === 0 ? (
            <div className="text-sm text-foreground/70">
              Ví dụ: “Thông tư này áp dụng đối với những đối tượng nào?”
            </div>
          ) : null}

          {messages.map((m, idx) => {
            const isUser = m.role === "user";
            return (
              <div key={idx} className={isUser ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    isUser
                      ? "max-w-[90%] rounded-lg bg-foreground px-3 py-2 text-background"
                      : "max-w-[90%] rounded-lg border border-foreground/15 bg-background px-3 py-2"
                  }
                >
                  <div className="whitespace-pre-wrap text-sm leading-6">{m.content}</div>

                  {!isUser ? (
                    <div className="mt-3 border-t border-foreground/15 pt-2">
                      <div className="text-xs font-medium text-foreground/80">Căn cứ</div>
                      {(m as Extract<ChatMessage, { role: "assistant" }>).citations.length ? (
                        <div className="mt-2 flex flex-col gap-2">
                          {(m as Extract<ChatMessage, { role: "assistant" }>).citations
                            .slice(0, 3)
                            .map((c) => (
                              <div key={c.ref} className="rounded-md border border-foreground/15 p-2">
                                <div className="text-xs text-foreground/90">
                                  <span className="font-medium">{c.id}</span> — {c.chapter_name} — {c.article}
                                </div>
                                <div className="mt-1 text-xs text-foreground/70">{c.quote}</div>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-foreground/70">Không có trích dẫn phù hợp.</div>
                      )}
                      <div className="mt-2 text-[11px] text-foreground/60">
                        {(m as Extract<ChatMessage, { role: "assistant" }>).usedLLM
                          ? "Đã dùng LLM để tổng hợp từ các trích đoạn."
                          : "Chưa cấu hình LLM; đang trả theo kết quả truy hồi."}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="sticky bottom-0 bg-background pt-2">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
              placeholder="Nhập câu hỏi…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              disabled={isLoading}
            />
            <button
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
              onClick={() => void sendMessage()}
              disabled={!canSend}
            >
              Gửi
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
