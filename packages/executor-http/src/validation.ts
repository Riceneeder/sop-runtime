import { buildToolErrorResult } from '@sop-runtime/adapter-core';
import { JsonObject, StepPacket, StepResult } from '@sop-runtime/definition';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function invalidConfig(packet: StepPacket, msg: string): { ok: false; result: StepResult } {
  return { ok: false, result: buildToolErrorResult(packet, 'http_invalid_config', msg) };
}

function invalidUrl(packet: StepPacket, msg: string): { ok: false; result: StepResult } {
  return { ok: false, result: buildToolErrorResult(packet, 'http_invalid_url', msg) };
}

function originNotAllowed(packet: StepPacket, msg: string): { ok: false; result: StepResult } {
  return { ok: false, result: buildToolErrorResult(packet, 'http_origin_not_allowed', msg) };
}

function bodyNotAllowed(packet: StepPacket, msg: string): { ok: false; result: StepResult } {
  return { ok: false, result: buildToolErrorResult(packet, 'http_body_not_allowed', msg) };
}

// ---------------------------------------------------------------------------
// Public validation functions
// ---------------------------------------------------------------------------

export function validateMethod(
  config: JsonObject,
  packet: StepPacket,
): { ok: true; method: string } | { ok: false; result: StepResult } {
  const method = config.method;
  if (typeof method !== 'string') {
    return invalidConfig(packet, `Method must be a string, got ${typeof method}.`);
  }
  if (!VALID_METHODS.includes(method as never)) {
    return invalidConfig(
      packet,
      `Invalid HTTP method: ${method}. Allowed: ${VALID_METHODS.join(', ')}.`,
    );
  }
  return { ok: true, method };
}

export function validateUrl(
  urlStr: unknown,
  packet: StepPacket,
): { ok: true; url: URL } | { ok: false; result: StepResult } {
  if (typeof urlStr !== 'string' || urlStr.length === 0) {
    return invalidUrl(packet, 'URL must be a non-empty string.');
  }

  let parsed: URL;
  try { parsed = new URL(urlStr); } catch {
    return invalidUrl(packet, `Failed to parse URL: ${urlStr}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return invalidUrl(packet, `Unsupported protocol: ${parsed.protocol}. Only http and https are allowed.`);
  }

  if (parsed.username || parsed.password) {
    return invalidUrl(packet, 'URL must not contain userinfo (username or password).');
  }

  return { ok: true, url: parsed };
}

export function validateOrigin(
  url: URL,
  allowedOrigins: string[],
  packet: StepPacket,
): { ok: true } | { ok: false; result: StepResult } {
  if (allowedOrigins.length === 0) {
    return originNotAllowed(packet, 'No origins are allowed. Configure allowedOrigins to permit requests.');
  }

  const requestOrigin = url.origin;
  for (const origin of allowedOrigins) {
    try {
      if (new URL(origin).origin === requestOrigin) {
        return { ok: true };
      }
    } catch {
      continue;
    }
  }

  return originNotAllowed(
    packet,
    `Origin ${requestOrigin} is not in the allowed origins list.`,
  );
}

export function validateBodyConfig(
  method: string,
  config: JsonObject,
  packetInputs: JsonObject,
  packet: StepPacket,
): { ok: true; body: string | undefined } | { ok: false; result: StepResult } {
  const hasBodyInConfig = config.body !== undefined;

  const rawBodyFrom = config.body_from;
  const bodyFrom: 'config' | 'inputs' | 'none' =
    rawBodyFrom === 'config' || rawBodyFrom === 'inputs' || rawBodyFrom === 'none'
      ? rawBodyFrom
      : (hasBodyInConfig ? 'config' : 'none');

  if (bodyFrom === 'none' && hasBodyInConfig) {
    return invalidConfig(
      packet,
      `${method} method with body_from "none" must not have a body configured.`,
    );
  }

  if (method === 'GET' && bodyFrom !== 'none') {
    return bodyNotAllowed(packet, 'GET request must not include a body.');
  }

  let body: string | undefined;
  if (bodyFrom === 'inputs') {
    body = JSON.stringify(packetInputs);
  } else if (bodyFrom === 'config' && hasBodyInConfig) {
    body = JSON.stringify(config.body);
  }

  return { ok: true, body };
}
