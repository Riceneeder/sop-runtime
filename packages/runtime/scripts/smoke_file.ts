#!/usr/bin/env bun
/**
 * Smoke test for @sop-runtime/executor-file.
 *
 * Creates a temp workspace directory, writes a known test file, creates an
 * inline SOP definition with a file read step, executes via RuntimeHost +
 * createFileExecutor, asserts file content. Cleans up the temp dir on exit.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateDefinition } from '@sop-runtime/validator';
import {
  RuntimeHost,
  InMemoryStateStore,
  DefaultDecisionProvider,
} from '@sop-runtime/runtime';
import { createFileExecutor } from '@sop-runtime/executor-file';

const tmpDir = mkdtempSync(join(tmpdir(), 'sop-smoke-file-'));
const testContent = 'Hello from file smoke test!';
writeFileSync(join(tmpDir, 'test.txt'), testContent, 'utf8');

const definition = {
  sop_id: 'smoke-file',
  name: 'File Adapter Smoke Test',
  version: '1.0.0',
  description: 'Reads a file from temp workspace via file executor',
  entry_step: 'read_file',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  policies: {
    cooldown_secs: 0,
    max_run_secs: 30,
    idempotency_key_template: 'smoke-file:static',
    concurrency: { mode: 'singleflight', key_template: 'smoke-file:static' },
  },
  steps: [
    {
      id: 'read_file',
      title: 'Read Test File',
      description: 'Reads test.txt via file executor',
      inputs: {},
      executor: {
        kind: 'file',
        name: 'file',
        config: {
          action: 'read',
          path: 'test.txt',
        },
        timeout_secs: 10,
        allow_network: false,
        env: {},
        resource_limits: { max_output_bytes: 4096, max_artifacts: 0 },
      },
      output_schema: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['content', 'path'],
        additionalProperties: true,
      },
      retry_policy: { max_attempts: 1, backoff_secs: [], retry_on: [] },
      supervision: {
        allowed_outcomes: [{ id: 'continue', description: 'Accept file read output' }],
        default_outcome: 'continue',
        owner: 'main_agent',
      },
      transitions: {
        continue: { terminate: { reason: 'done', run_status: 'succeeded' } },
      },
    },
  ],
  final_output: {
    content: '${steps.read_file.output.content}',
    path: '${steps.read_file.output.path}',
  },
};

const validation = validateDefinition(definition);
if (!validation.ok) {
  console.error('FAIL: definition validation failed', JSON.stringify(validation.diagnostics, null, 2));
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}

const host = new RuntimeHost({
  store: new InMemoryStateStore(),
  decisionProvider: new DefaultDecisionProvider(),
});

const fileAdapter = createFileExecutor({
  workspaceRoot: tmpDir,
  allowWrite: false,
  allowDelete: false,
  allowSymlinks: false,
});
host.registerExecutor(fileAdapter.kind, fileAdapter.name, fileAdapter.handler);

try {
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
  if (!completed.final_output || completed.final_output.content !== testContent) {
    console.error('FAIL: unexpected final_output', JSON.stringify(completed.final_output));
    process.exit(1);
  }

  console.log('OK file smoke — content:', completed.final_output.content, 'path:', completed.final_output.path);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
