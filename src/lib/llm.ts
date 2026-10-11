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

/** 视觉模型：LLM_VISION_MODEL 优先，缺省回落 LLM_MODEL（v6.43.0 截图识别） */
export function llmVisionModel(env: Env): string | undefined {
  return env.LLM_VISION_MODEL || env.LLM_MODEL;
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
  const parsed = extractJsonObject(text);
  if (parsed === null) throw new HttpError(502, 'LLM 回的不是合法 JSON，请重试或换个说法');
  return parsed as T;
}

/**
 * 从模型回包文本里提取完整的 JSON 对象。
 * 先整段直解；不行再从尾部往前找第一个能解析的 `{…}`——thinking 模型可能在正文里带推理，
 * 推理里也可能出现 JSON 片段，只有「最后一个可解析对象」才是最终答案（v6.43.0 spike 实测口径）。
 */
export function extractJsonObject(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // 继续按尾部扫描兜底
  }
  for (let start = cleaned.lastIndexOf('{'); start >= 0; start = cleaned.lastIndexOf('{', start - 1)) {
    const end = cleaned.lastIndexOf('}');
    if (end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      // 往前继续找
    }
  }
  return null;
}

export interface LlmVisionImage {
  mime: 'image/png' | 'image/jpeg';
  base64: string;
}

/**
 * 一次视觉 chat/completions：图片（base64 data URL）+ 文字提示，要求模型只回 JSON。
 * v6.43.0 成长录入截图识别专用（管理端 only）；不带 response_format（视觉模型兼容面窄，
 * 靠提示词约束 + extractJsonObject 兜底）；超时 90s（spike 实测 13-27s/图，留足余量）。
 * 失败/超时/空回包与 llmChat 同口径抛 HttpError(502)，绝不静默编造。
 */
export async function llmVisionJson<T>(env: Env, image: LlmVisionImage, prompt: string, maxTokens = 4096): Promise<T> {
  const model = llmVisionModel(env);
  if (!env.LLM_API_BASE || !env.LLM_API_KEY || !model) {
    throw new HttpError(503, '未配置 LLM（LLM_API_BASE / LLM_API_KEY / LLM_VISION_MODEL 或 LLM_MODEL）');
  }
  const base = env.LLM_API_BASE.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LLM_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } },
              { type: 'text', text: prompt },
            ],
          },
        ],
        max_tokens: maxTokens,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(90_000),
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
  const parsed = extractJsonObject(text);
  if (parsed === null) throw new HttpError(502, 'LLM 回的不是合法 JSON，请重试');
  return parsed as T;
}
