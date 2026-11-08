// Calls any OpenAI-compatible chat endpoint (NVIDIA Nemotron, OpenAI, OpenRouter, ...)
// from inside a SpacetimeDB procedure. Network I/O only; no database access here.
import { TimeDuration } from 'spacetimedb';

type HttpLike = {
  fetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body: string; timeout?: TimeDuration }
  ): { status: number; text(): string };
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatResult = { ok: true; text: string; model: string } | { ok: false; error: string };

export function callChat(
  http: HttpLike,
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[]
): ChatResult {
  let res: { status: number; text(): string };
  try {
    res = http.fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 400 }),
      timeout: TimeDuration.fromMillis(25_000),
    });
  } catch (err) {
    return { ok: false, error: `transport: ${err instanceof Error ? err.message : String(err)}` };
  }

  const body = res.text();
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 300)}` };
  }
  try {
    const parsed = JSON.parse(body);
    let text = parsed?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, error: 'empty response' };
    }
    // Some reasoning models wrap their thinking in <think> tags. Strip it.
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return { ok: true, text, model: String(parsed.model ?? model) };
  } catch (err) {
    return { ok: false, error: `parse: ${err instanceof Error ? err.message : String(err)}` };
  }
}
