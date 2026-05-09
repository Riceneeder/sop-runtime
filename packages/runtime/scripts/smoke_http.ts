#!/usr/bin/env bun
/**
 * Smoke test for @sop-runtime/executor-http.
 *
 * Starts a local Bun.serve mock server, creates an inline SOP definition
 * with an HTTP step, executes via RuntimeHost + createHttpExecutor,
 * and asserts final output. Shuts down the server when done.
 */

import { validateDefinition } from '@sop-runtime/validator';
import {
  RuntimeHost,
  InMemoryStateStore,
  DefaultDecisionProvider,
} from '@sop-runtime/runtime';
import { createHttpExecutor } from '@sop-runtime/executor-http';

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/ping' && req.method === 'GET') {
      return new Response(JSON.stringify({ ok: true, pong: 'pong' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  },
});

const { port } = server;

const definition = {
  sop_id: 'smoke-http',
  name: 'HTTP Adapter Smoke Test',
  version: '1.0.0',
  description: 'Makes a GET request to a local mock server',
  entry_step: 'ping',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  policies: {
    cooldown_secs: 0,
    max_run_secs: 30,
    idempotency_key_template: 'smoke-http:static',
    concurrency: { mode: 'singleflight', key_template: 'smoke-http:static' },
  },
  steps: [
    {
      id: 'ping',
      title: 'Ping',
      description: 'GET /ping on local mock server',
      inputs: {},
      executor: {
        kind: 'http',
        name: 'request',
        config: {
          method: 'GET',
          url: `http://localhost:${port}/ping`,
        },
        timeout_secs: 10,
        allow_network: true,
        env: {},
        resource_limits: { max_output_bytes: 4096, max_artifacts: 0 },
      },
      output_schema: {
        type: 'object',
        properties: {
          status: { type: 'number' },
          body: { type: 'object' },
        },
        required: ['status'],
        additionalProperties: true,
      },
      retry_policy: { max_attempts: 1, backoff_secs: [], retry_on: [] },
      supervision: {
        allowed_outcomes: [{ id: 'continue', description: 'Accept HTTP response' }],
        default_outcome: 'continue',
        owner: 'main_agent',
      },
      transitions: {
        continue: { terminate: { reason: 'done', run_status: 'succeeded' } },
      },
    },
  ],
  final_output: {
    pong: '${steps.ping.output.body.pong}',
    status: '${steps.ping.output.status}',
  },
};

const validation = validateDefinition(definition);
if (!validation.ok) {
  console.error('FAIL: definition validation failed', JSON.stringify(validation.diagnostics, null, 2));
  server.stop();
  process.exit(1);
}

const host = new RuntimeHost({
  store: new InMemoryStateStore(),
  decisionProvider: new DefaultDecisionProvider(),
});

const httpAdapter = createHttpExecutor({
  allowNetwork: true,
  allowedOrigins: [`http://localhost:${port}`],
  resolveConfigTemplates: false,
});
host.registerExecutor(httpAdapter.kind, httpAdapter.name, httpAdapter.handler);

try {
  const started = await host.startRun({ definition, input: {} });
  if (started.state.status !== 'running') {
    console.error('FAIL: run did not start', JSON.stringify(started));
    server.stop();
    process.exit(1);
  }

  const completed = await host.runUntilComplete({ definition, runId: started.state.run_id });
  if (completed.state.status !== 'succeeded') {
    console.error('FAIL: run did not succeed', JSON.stringify(completed.state, null, 2));
    server.stop();
    process.exit(1);
  }
  if (!completed.final_output || completed.final_output.pong !== 'pong') {
    console.error('FAIL: missing or invalid final_output', JSON.stringify(completed.final_output));
    server.stop();
    process.exit(1);
  }

  console.log('OK http smoke — pong:', completed.final_output.pong, 'status:', completed.final_output.status);
} finally {
  server.stop();
}
