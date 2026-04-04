import { NextResponse } from 'next/server';
import { z } from 'zod';

import { answerWithRag } from '@/lib/chat';
import { retrieve } from '@/lib/rag';

export const runtime = 'nodejs';

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const BodySchema = z.object({
  messages: z.array(MessageSchema).min(1),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const body = BodySchema.parse(json);

    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
    const question = lastUser?.content?.trim();
    if (!question) {
      return NextResponse.json({ error: 'Missing user message' }, { status: 400 });
    }

    const { docs, citations } = retrieve(question, 5);
    const result = await answerWithRag({ question, docs, citations });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
