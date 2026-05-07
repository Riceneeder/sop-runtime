import { buildSuccessResult, buildToolErrorResult, redactSecrets } from '@sop-runtime/adapter-core';
import { JsonObject, JsonValue, StepPacket, StepResult } from '@sop-runtime/definition';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function normalizeBodyText(bodyText: string): JsonObject {
  if (bodyText.length === 0) return {};

  try {
    const parsed = JSON.parse(bodyText);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
    return { value: parsed as JsonValue };
  } catch {
    return { text: bodyText };
  }
}

function collectHeaders(response: Response, sensitiveKeys: string[]): JsonObject {
  const headersObj: JsonObject = {};
  for (const [key, value] of response.headers.entries()) {
    headersObj[key] = value;
  }
  return redactSecrets(headersObj, sensitiveKeys) as JsonObject;
}

// ---------------------------------------------------------------------------
// Body reading
// ---------------------------------------------------------------------------

export async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
  packet: StepPacket,
): Promise<{ ok: true; text: string } | { ok: false; result: StepResult }> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const length = parseInt(contentLength, 10);
    if (!isNaN(length) && length > maxBytes) {
      return {
        ok: false,
        result: buildToolErrorResult(packet, 'http_response_too_large',
          `Response Content-Length (${length} bytes) exceeds limit (${maxBytes} bytes).`,
          { content_length: length, max_bytes: maxBytes }),
      };
    }
  }

  const reader = response.body?.getReader();
  if (!reader) return { ok: true, text: '' };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return {
          ok: false,
          result: buildToolErrorResult(packet, 'http_response_too_large',
            `Response body exceeds limit (${maxBytes} bytes).`,
            { total_bytes: totalBytes, max_bytes: maxBytes }),
        };
      }
      chunks.push(value);
    }
  } catch {
    return {
      ok: false,
      result: buildToolErrorResult(packet, 'http_network_error',
        'Failed to read response body.'),
    };
  }

  const combined = concatUint8Arrays(chunks);
  return { ok: true, text: new TextDecoder().decode(combined) };
}

// ---------------------------------------------------------------------------
// Output normalization
// ---------------------------------------------------------------------------

export function normalizeSuccessOutput(
  response: Response,
  bodyText: string,
  sensitiveKeys: string[],
): JsonObject {
  return {
    status: response.status,
    status_text: response.statusText,
    headers: collectHeaders(response, sensitiveKeys),
    body: normalizeBodyText(bodyText),
  };
}

export function normalizeErrorOutput(
  response: Response,
  bodyText: string,
  sensitiveKeys: string[],
): JsonObject {
  const bodyPreview = bodyText.length > 200
    ? bodyText.slice(0, 200) + '...'
    : bodyText;

  return {
    status: response.status,
    status_text: response.statusText,
    headers: collectHeaders(response, sensitiveKeys),
    body_preview: bodyPreview,
  };
}

// ---------------------------------------------------------------------------
// Response processor
// ---------------------------------------------------------------------------

export async function processHttpResponse(
  response: Response,
  maxBytes: number,
  packet: StepPacket,
  sensitiveKeys: string[],
): Promise<StepResult> {
  const bodyResult = await readBodyWithLimit(response, maxBytes, packet);
  if (!bodyResult.ok) return bodyResult.result;
  const bodyText = bodyResult.text;

  if (response.status >= 300 && response.status < 400) {
    return buildToolErrorResult(
      packet, 'http_redirect_not_followed',
      `Redirect not followed (${response.status} ${response.statusText}).`,
      normalizeErrorOutput(response, bodyText, sensitiveKeys),
    );
  }

  if (response.status < 200 || response.status >= 300) {
    return buildToolErrorResult(
      packet, 'http_non_2xx_response',
      `HTTP ${response.status} ${response.statusText}.`,
      normalizeErrorOutput(response, bodyText, sensitiveKeys),
    );
  }

  return buildSuccessResult(
    packet,
    normalizeSuccessOutput(response, bodyText, sensitiveKeys),
  );
}
