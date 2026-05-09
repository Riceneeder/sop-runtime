#!/usr/bin/env bun
/**
 * Smoke test for @sop-runtime/executor-shell.
 *
 * Creates an inline SOP definition with a shell step that runs `bun --version`,
 * executes it via RuntimeHost + createShellExecutor, and asserts final output.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateDefinition } from '@sop-runtime/validator';
import {
  RuntimeHost,
  InMemoryStateStore,
  DefaultDecisionProvider,
} from '@sop-runtime/runtime';
import { createShellExecutor } from '@sop-runtime/executor-shell';

const BUN_PATH = process.env.BUN_PATH || process.execPath || '/usr/local/bin/bun';

if (!existsSync(BUN_PATH)) {
  console.error(`FAIL: bun executable not found at ${BUN_PATH}`);
  process.exit(1);
}

const definition = {
  $schema: '../schemas/sop-definition.schema.json',
  sop_id: 'smoke-shell',
  name: 'Shell Adapter Smoke Test',
  version: '1.0.0',
  description: 'Runs bun --version via shell executor',
  entry_step: 'version',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  policies: {
    cooldown_secs: 0,
    max_run_secs: 30,
    idempotency_key_template: 'smoke-shell:static',
    concurrency: { mode: 'singleflight', key_template: 'smoke-shell:static' },
  },
  steps: [
    {
      id: 'version',
      title: 'Get Bun Version',
      description: 'Runs bun --version',
      inputs: {},
      executor: {
        kind: 'shell',
        name: 'local_command',
        config: { command: 'bun', args: ['--version'] },
        timeout_secs: 10,
        allow_network: false,
        env: {},
        resource_limits: { max_output_bytes: 4096, max_artifacts: 0 },
      },
      output_schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      retry_policy: { max_attempts: 1, backoff_secs: [], retry_on: [] },
      supervision: {
        allowed_outcomes: [{ id: 'continue', description: 'Accept version output' }],
        default_outcome: 'continue',
        owner: 'main_agent',
      },
      transitions: {
        continue: { terminate: { reason: 'done', run_status: 'succeeded' } },
      },
    },
  ],
  final_output: {
    bun_version: '${steps.version.output.text}',
  },
};

const validation = validateDefinition(definition);
if (!validation.ok) {
  console.error('FAIL: definition validation failed', JSON.stringify(validation.diagnostics, null, 2));
  process.exit(1);
}

const host = new RuntimeHost({
  store: new InMemoryStateStore(),
  decisionProvider: new DefaultDecisionProvider(),
});

const shellAdapter = createShellExecutor({
  workspaceRoot: resolve('.'),
  allowedCommands: { bun: BUN_PATH },
});
host.registerExecutor(shellAdapter.kind, shellAdapter.name, shellAdapter.handler);

const started = await host.startRun({ definition, input: {} });
if (started.state.status !== 'running') {
  console.error('FAIL: run did not start', JSON.stringify(started));
  process.exit(1);
}

const completed = await host.runUntilComplete({ definition, runId: started.state.run_id });
if (completed.state.status !== 'succeeded') {
  console.error('FAIL: run did not succeed', JSON.stringify(completed.state, null, 2));
  process.exit(1);
}
if (!completed.final_output || typeof completed.final_output.bun_version !== 'string') {
  console.error('FAIL: missing or invalid final_output', JSON.stringify(completed.final_output));
  process.exit(1);
}

console.log('OK shell smoke — bun version:', completed.final_output.bun_version);
