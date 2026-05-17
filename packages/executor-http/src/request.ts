import { buildToolErrorResult } from '@sop-runtime/adapter-core';
import { StepPacket, StepResult } from '@sop-runtime/definition';

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

export function buildRequestHeaders(
  configHeaders: unknown,
  body: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (typeof configHeaders === 'object' && configHeaders !== null && !Array.isArray(configHeaders)) {
    for (const [key, value] of Object.entries(configHeaders as Record<string, unknown>)) {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }
  }

  if (body !== undefined && !Object.keys(headers).some(
    (k) => k.toLowerCase() === 'content-type',
  )) {
    headers['content-type'] = 'application/json';
  }

  return headers;
}

// ---------------------------------------------------------------------------
// Fetch execution with timeout
// ---------------------------------------------------------------------------

export async function executeFetchWithTimeout(
  url: string,
  init: Parameters<typeof fetch>[1],
  timeoutSecs: number,
  packet: StepPacket,
  signal?: AbortSignal,
): Promise<{ ok: true; response: Response } | { ok: false; result: StepResult }> {
  const ac = new AbortController();
  const timeoutMs = Math.min(timeoutSecs * 1000, 2_147_483_647);
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  // Compose internal timeout with external cancellation signal
  if (signal !== undefined) {
    if (signal.aborted) {
      clearTimeout(timer);
      return {
        ok: false,
        result: {
          run_id: packet.run_id,
          step_id: packet.step_id,
          attempt: packet.attempt,
          status: 'timeout' as const,
          error: {
            code: 'http_timeout',
            message: `Request timed out after ${timeoutSecs} seconds.`,
            details: { timeout_secs: timeoutSecs },
          },
        },
      };
    }
    signal.addEventListener('abort', () => { clearTimeout(timer); ac.abort(); }, { once: true });
  }

  try {
    const combinedSignal = AbortSignal.any([ac.signal, ...(signal !== undefined ? [signal] : [])]);
    const response = await fetch(url, { ...init, signal: combinedSignal });
    clearTimeout(timer);
    return { ok: true, response };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        ok: false,
        result: {
          run_id: packet.run_id,
          step_id: packet.step_id,
          attempt: packet.attempt,
          status: 'timeout' as const,
          error: {
            code: 'http_timeout',
            message: `Request timed out after ${timeoutSecs} seconds.`,
            details: { timeout_secs: timeoutSecs },
          },
        },
      };
    }
    return {
      ok: false,
      result: buildToolErrorResult(
        packet, 'http_network_error',
        `Network error: ${(err as Error).message}`,
      ),
    };
  }
}
