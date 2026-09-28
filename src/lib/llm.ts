// LLM 草稿工坊的出站客户端（v6.12.0，D3，管理端 only）。
// OpenAI 兼容 chat/completions：LLM_API_BASE / LLM_API_KEY / LLM_MODEL 三变量，不绑具体厂商；
// 任一缺失 = 未配置（调用方回 503 旁路，不进玩家请求路径）。
// 边界（与参考插件 services/llm_writer.py 相同）：LLM 只碰文案与创意草稿，数值效果永远由
// 事件结构 + config 钳制决定；失败/超时/空回包一律抛 HttpError(502) 让管理端看到原文重试，绝不静默编造。
import type { Env } from '../worker/env.ts';
import { HttpError } from './http.ts';

const LLM_TIMEOUT_MS = 60_000;

/** 三变量齐了才算配置（缺 key / 缺 base / 缺 model 都按未配置处理） */
export function llmConfigured(env: Env): boolean {
  return Boolean(env.LLM_API_BASE && env.LLM_API_KEY && env.LLM_MODEL);
}

interface LlmChatOptions {
  system: string;
  user: string;
  /** 希望模型只回 JSON：带 response_format（不支持该字段的兼容端点会 4xx，错误原文透出给管理端） */
  json?: boolean;
  maxTokens?: number;
}

/** 一次 chat/completions 调用，回首个 choice 的文本内容。网络/HTTP/空回包都抛 502。 */
export async function llmChat(env: Env, opts: LlmChatOptions): Promise<string> {
  if (!llmConfigured(env)) throw new HttpError(503, '未配置 LLM（LLM_API_BASE / LLM_API_KEY / LLM_MODEL）');
  const base = (env.LLM_API_BASE as string).replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        max_tokens: opts.maxTokens ?? 800,
        temperature: 0.8,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HttpError(502, `LLM 请求失败：${msg}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    throw new HttpError(502, `LLM 返回 ${res.status}${body ? `：${body}` : ''}`);
  }
  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.trim() === '') throw new HttpError(502, 'LLM 回包为空');
  return text.trim();
}

/** 要求模型回 JSON 的调用：剥掉 ``` 围栏后 JSON.parse，解析失败抛 502（管理端看原文重试）。 */
export async function llmChatJson<T>(env: Env, opts: LlmChatOptions): Promise<T> {
  const text = await llmChat(env, { ...opts, json: true });
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    throw new HttpError(502, 'LLM 回的不是合法 JSON，请重试或换个说法');
  }
}
