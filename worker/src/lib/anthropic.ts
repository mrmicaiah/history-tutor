import { log } from './logger';
import { TimeoutError, UpstreamError } from './errors';
import {
  ANTHROPIC_TIMEOUT_MS,
  ANTHROPIC_URL,
  ANTHROPIC_VERSION,
} from '../config';

/**
 * Minimal Anthropic Messages API client.
 *
 * Hand-rolled around `fetch` to avoid pulling in `@anthropic-ai/sdk`, which
 * carries Node-specific transport assumptions awkward in Workers. The
 * response shape we depend on is small and stable.
 *
 * Failure modes mapped to typed errors:
 *   - Network failure / DNS error      -> UpstreamError (502)
 *   - AbortController fires            -> TimeoutError (504)
 *   - Non-2xx HTTP response            -> UpstreamError (502)
 *   - Non-JSON or malformed body       -> UpstreamError (502)
 *
 * The function never throws raw fetch errors; callers can lean on the AppError
 * hierarchy without try/catch sprawl.
 */

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface ClaudeResult {
  content: string;
  usage: ClaudeUsage;
}

interface RawContentBlock {
  type: string;
  text?: string;
}

interface RawResponse {
  content?: RawContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface CallClaudeParams {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ClaudeMessage[];
  maxTokens: number;
}

/**
 * Call Anthropic's Messages API and return the concatenated text content +
 * usage stats. Subject to the timeout / failure mapping documented above.
 */
export async function callClaude(params: CallClaudeParams): Promise<ClaudeResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': params.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        system: params.systemPrompt,
        messages: params.messages,
        max_tokens: params.maxTokens,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const aborted = err instanceof Error && err.name === 'AbortError';
    if (aborted) {
      log.error('anthropic_timeout', { timeout_ms: ANTHROPIC_TIMEOUT_MS });
      throw new TimeoutError('anthropic request timed out');
    }
    log.error('anthropic_fetch_failed', { error: err });
    throw new UpstreamError('anthropic request failed');
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    let snippet = '';
    try {
      const text = await response.text();
      snippet = text.slice(0, 500);
    } catch {
      /* body unreadable; snippet stays empty */
    }
    log.error('anthropic_non_2xx', {
      status: response.status,
      body_snippet: snippet,
    });
    throw new UpstreamError(`anthropic returned status ${response.status}`);
  }

  let data: RawResponse;
  try {
    data = (await response.json()) as RawResponse;
  } catch (err) {
    log.error('anthropic_invalid_json', { error: err });
    throw new UpstreamError('anthropic returned invalid JSON');
  }

  const text = (data.content ?? [])
    .filter((b): b is RawContentBlock & { text: string } =>
      b.type === 'text' && typeof b.text === 'string',
    )
    .map((b) => b.text)
    .join('');

  return {
    content: text,
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    },
  };
}
