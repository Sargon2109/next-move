// Calls the Claude Messages API from inside a SpacetimeDB procedure.
// Raw HTTP on purpose: procedures are synchronous and can only reach the network through
// ctx.http.fetch, so the async Anthropic SDK can't run here. Network I/O only; no database access.
import { TimeDuration } from 'spacetimedb';

export const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-opus-5-5';

type HttpLike = {
  fetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body: string; timeout?: TimeDuration }
  ): { status: number; text(): string };
};

export type ChatResult = { ok: true; text: string; model: string } | { ok: false; error: string };

type ClaudeResponse = {
  model?: string;
  stop_reason?: string;
  stop_details?: { category?: string | null } | null;
  content?: Array<{ type: string; text?: string }>;
};

export function callClaude(
  http: HttpLike,
  config: { endpoint: string; apiKey: string; model: string },
  system: string,
  user: string
): ChatResult {
  let res: { status: number; text(): string };
  try {
    res = http.fetch(config.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2026-10-21',
        // If a safety classifier declines, Anthropic re-runs the request on its recommended fallback model.
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model: config.model || DEFAULT_MODEL,
        max_tokens: 16000,
        // A short, plain-English explanation: low effort keeps it quick for a live demo.
        output_config: { effort: 'low' },
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: user }],
      }),
      timeout: TimeDuration.fromMillis(45_000),
    });
  } catch (err) {
    return { ok: false, error: `transport: ${err instanceof Error ? err.message : String(err)}` };
  }

  const body = res.text();
  if (res.status < 200 || res.status >= 300) {
    const hint =
      res.status === 401 ? ' (check the API key)' : res.status === 429 ? ' (rate limited, try again shortly)' : res.status >= 500 ? ' (Claude is busy, try again)' : '';
    return { ok: false, error: `HTTP ${res.status}${hint}: ${body.slice(0, 300)}` };
  }

  let parsed: ClaudeResponse;
  try {
    parsed = JSON.parse(body) as ClaudeResponse;
  } catch (err) {
    return { ok: false, error: `parse: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (parsed.stop_reason === 'refusal') {
    return { ok: false, error: `declined (${parsed.stop_details?.category ?? 'no category'})` };
  }
  const text = (parsed.content ?? [])
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('')
    .trim();
  if (!text) return { ok: false, error: `empty response (stop_reason: ${parsed.stop_reason ?? 'unknown'})` };
  return { ok: true, text, model: parsed.model ?? (config.model || DEFAULT_MODEL) };
}
