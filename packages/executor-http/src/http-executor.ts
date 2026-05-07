import { buildToolErrorResult, resolveExecutorConfigTemplate, ExecutorAdapter, ExecutorHandlerInput } from '@sop-runtime/adapter-core';
import { StepPacket } from '@sop-runtime/definition';
import { validateMethod, validateUrl, validateOrigin, validateBodyConfig } from './validation.js';
import { executeFetchWithTimeout, buildRequestHeaders } from './request.js';
import { processHttpResponse } from './response.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SENSITIVE_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'token',
  'secret',
  'password',
];

const ONE_MB = 1_048_576;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HttpExecutorOptions {
  allowNetwork: boolean;
  allowedOrigins: string[];
  resolveConfigTemplates?: boolean;
  sensitiveHeaders?: string[];
  maxResponseBytes?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHttpExecutor(options: HttpExecutorOptions): ExecutorAdapter {
  return {
    kind: 'http',
    name: 'request',
    description: 'Makes HTTP requests as SOP steps',
    handler: async (input: ExecutorHandlerInput) => {
      if (!options.allowNetwork) {
        return buildToolErrorResult(
          input.packet as unknown as StepPacket, 'http_network_disabled',
          'Network access is disabled by adapter configuration.',
        );
      }

      if (!input.packet.executor.allow_network) {
        return buildToolErrorResult(
          input.packet as unknown as StepPacket, 'http_step_network_not_allowed',
          'Network access is disabled for this step.',
        );
      }

      let config = input.packet.executor.config ?? {};
      const packet = input.packet as unknown as StepPacket;

      // Resolve expression templates when enabled
      if (options.resolveConfigTemplates) {
        config = resolveExecutorConfigTemplate({ config, context: { run: input.state } });
      }

      const methodResult = validateMethod(config, packet);
      if (!methodResult.ok) return methodResult.result;

      const urlResult = validateUrl(config.url, packet);
      if (!urlResult.ok) return urlResult.result;

      const originResult = validateOrigin(urlResult.url, options.allowedOrigins, packet);
      if (!originResult.ok) return originResult.result;

      const bodyResult = validateBodyConfig(methodResult.method, config, input.packet.inputs, packet);
      if (!bodyResult.ok) return bodyResult.result;

      const headers = buildRequestHeaders(config.headers, bodyResult.body);

      const sensitiveKeys = [
        ...(options.sensitiveHeaders ?? DEFAULT_SENSITIVE_HEADERS),
        'set-cookie',
      ];
      const maxBytes = options.maxResponseBytes ?? ONE_MB;

      const fetchResult = await executeFetchWithTimeout(
        urlResult.url.href,
        { method: methodResult.method, headers, body: bodyResult.body, redirect: 'manual' },
        input.packet.executor.timeout_secs,
        packet,
      );
      if (!fetchResult.ok) return fetchResult.result;

      return processHttpResponse(fetchResult.response, maxBytes, packet, sensitiveKeys);
    },
  };
}
