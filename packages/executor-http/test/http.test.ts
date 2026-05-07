import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { ExecutorHandlerInput } from '@sop-runtime/adapter-core';
import { SopDefinition, RunState } from '@sop-runtime/definition';
import { createHttpExecutor, HttpExecutorOptions } from '../src/index.js';

let MOCK_SERVER_URL: string;
let mockServer: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  mockServer = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/get') {
        return new Response(JSON.stringify({ message: 'ok', items: [1, 2, 3] }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-custom': 'test-value' },
        });
      }
      if (url.pathname === '/echo') {
        return new Response(req.body, {
          status: 200,
          headers: { 'content-type': req.headers.get('content-type') || 'text/plain' },
        });
      }
      if (url.pathname === '/status/404') {
        return new Response('Not Found', { status: 404 });
      }
      if (url.pathname === '/redirect') {
        return new Response(null, { status: 302, headers: { location: '/get' } });
      }
      return new Response('Unknown', { status: 500 });
    },
  });
  MOCK_SERVER_URL = `http://localhost:${mockServer.port}`;
});

afterAll(() => {
  mockServer.stop();
});

function makeInput(config: Record<string, unknown> = {}): ExecutorHandlerInput {
  return {
    packet: {
      run_id: 'test-run',
      step_id: 'test-step',
      attempt: 1,
      inputs: { ticket_id: 'T-001' },
      executor: {
        kind: 'http',
        name: 'request',
        timeout_secs: 10,
        allow_network: true,
        env: {},
        resource_limits: { max_output_bytes: 1048576, max_artifacts: 0 },
        config: { method: 'GET', url: `${MOCK_SERVER_URL}/get`, ...config },
      },
      output_schema: undefined,
    },
    definition: {
      sop_id: 'test-sop',
      sop_version: '1.0.0',
      start: { kind: 'explicit', step_ids: [] },
      steps: {},
    } as unknown as SopDefinition,
    state: {
      run_id: 'test-run',
      status: 'active',
      phase: 'ready',
      current_step_ids: [],
      history: [],
      metadata: {},
    } as unknown as RunState,
    config: {},
  };
}

function makeOptions(overrides: Partial<HttpExecutorOptions> = {}): HttpExecutorOptions {
  return {
    allowNetwork: true,
    allowedOrigins: [MOCK_SERVER_URL],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Non-network validation tests
// ---------------------------------------------------------------------------

describe('createHttpExecutor', () => {
  describe('network guards', () => {
    test('rejects when options.allowNetwork is false', async () => {
      const executor = createHttpExecutor(makeOptions({ allowNetwork: false }));
      const result = await executor.handler(makeInput());
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('http_network_disabled');
    });

    test('rejects when packet.executor.allow_network is false', async () => {
      const executor = createHttpExecutor(makeOptions());
      const input = makeInput();
      input.packet.executor = { ...input.packet.executor, allow_network: false };
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('http_step_network_not_allowed');
    });
  });

  describe('URL validation', () => {
    test('rejects URL origin not in allowedOrigins', async () => {
      const executor = createHttpExecutor(makeOptions({
        allowedOrigins: ['https://example.com'],
      }));
      const input = makeInput({ url: 'https://other.com/api' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('http_origin_not_allowed');
    });

    test('rejects empty allowedOrigins', async () => {
      const executor = createHttpExecutor(makeOptions({ allowedOrigins: [] }));
      const result = await executor.handler(makeInput());
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('http_origin_not_allowed');
    });

    test('rejects invalid URL', async () => {
      const executor = createHttpExecutor(makeOptions());
      const input = makeInput({ url: 'not a valid url' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('http_invalid_url');
    });

    test('rejects non-http/https protocol', async () => {
      const executor = createHttpExecutor(makeOptions({
        allowedOrigins: ['ftp://files.example.com'],
      }));
      const input = makeInput({ url: 'ftp://files.example.com/file' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('http_invalid_url');
    });

    test('rejects URL with userinfo', async () => {
      const executor = createHttpExecutor(makeOptions());
      const input = makeInput({ url: `https://user:pass@${mockServer.hostname}:${mockServer.port}/get` });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('http_invalid_url');
    });

    test('rejects invalid body_from value', async () => {
      const executor = createHttpExecutor(makeOptions());
      const input = makeInput({ url: `${MOCK_SERVER_URL}/get`, body_from: 'input' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('http_invalid_config');
    });
  });

  describe('body validation', () => {
    test('rejects GET with body', async () => {
      const executor = createHttpExecutor(makeOptions());
      const input = makeInput({
        method: 'GET',
        url: `${MOCK_SERVER_URL}/get`,
        body: { key: 'value' },
      });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('http_body_not_allowed');
    });

    test('rejects body_from=none with body present', async () => {
      const executor = createHttpExecutor(makeOptions());
      const input = makeInput({
        method: 'POST',
        url: `${MOCK_SERVER_URL}/echo`,
        body: { key: 'value' },
        body_from: 'none',
      });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('http_invalid_config');
    });
  });

  // -----------------------------------------------------------------------
  // Network tests (local mock server)
  // -----------------------------------------------------------------------

  describe('network requests', () => {
    test('successful GET returns output with status, headers, body', async () => {
      const executor = createHttpExecutor(makeOptions());
      const input = makeInput({ url: `${MOCK_SERVER_URL}/get` });
      const result = await executor.handler(input);

      expect(result.status).toBe('success');
      expect(result.output).toBeDefined();
      expect(result.output!.status).toBe(200);
      expect(result.output!.status_text).toBe('OK');
      expect(typeof result.output!.headers).toBe('object');
      expect(typeof result.output!.body).toBe('object');
    });

    test('non-2xx returns tool_error', async () => {
      const executor = createHttpExecutor(makeOptions());
      const input = makeInput({ url: `${MOCK_SERVER_URL}/status/404` });
      const result = await executor.handler(input);

      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('http_non_2xx_response');
      expect(result.error?.details?.status).toBe(404);
    });

    test('3xx redirect returns tool_error', async () => {
      const executor = createHttpExecutor(makeOptions());
      const input = makeInput({ url: `${MOCK_SERVER_URL}/redirect` });
      const result = await executor.handler(input);

      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('http_redirect_not_followed');
    });

    test('input is not mutated', async () => {
      const executor = createHttpExecutor(makeOptions());
      const config = { url: `${MOCK_SERVER_URL}/get` };
      const input = makeInput(config);
      const originalConfig = { ...input.packet.executor.config };
      await executor.handler(input);

      expect(input.packet.inputs).toEqual({ ticket_id: 'T-001' });
      expect(input.packet.executor.config).toEqual(originalConfig);
    });
  });
});
