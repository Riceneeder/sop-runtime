#!/usr/bin/env bun
/**
 * Smoke test for @sop-runtime/executor-agent.
 *
 * Creates an inline SOP definition with an agent step, uses a mock AgentRunner,
 * executes via RuntimeHost + createAgentExecutor, and asserts final output.
 */

import { validateDefinition } from '@sop-runtime/validator';
import {
  RuntimeHost,
  InMemoryStateStore,
  DefaultDecisionProvider,
} from '@sop-runtime/runtime';
import { createAgentExecutor } from '@sop-runtime/executor-agent';

const definition = {
  sop_id: 'smoke-agent',
  name: 'Agent Adapter Smoke Test',
  version: '1.0.0',
  description: 'Runs a mock agent step via agent executor',
  entry_step: 'greet',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  policies: {
    cooldown_secs: 0,
    max_run_secs: 30,
    idempotency_key_template: 'smoke-agent:static',
    concurrency: { mode: 'singleflight' as const, key_template: 'smoke-agent:static' },
  },
  steps: [
    {
      id: 'greet',
      title: 'Greet',
      description: 'Mock agent returns a greeting',
      inputs: {},
      executor: {
        kind: 'agent',
        name: 'local_agent',
        config: { agent_key: 'mock' },
        timeout_secs: 10,
        allow_network: false,
        env: {},
        resource_limits: { max_output_bytes: 4096, max_artifacts: 0 },
      },
      output_schema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
        additionalProperties: false,
      },
      retry_policy: { max_attempts: 1, backoff_secs: [], retry_on: [] },
      supervision: {
        allowed_outcomes: [{ id: 'continue', description: 'Accept agent output' }],
        default_outcome: 'continue',
        owner: 'main_agent',
      },
      transitions: {
        continue: { terminate: { reason: 'done', run_status: 'succeeded' } },
      },
    },
  ],
  final_output: {
    greeting: '${steps.greet.output.message}',
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

const agentAdapter = createAgentExecutor({
  runners: {
    mock: {
      async run() {
        return { output: { message: 'Hello from mock agent!' } };
      },
    },
  },
  defaultRunner: 'mock',
});
host.registerExecutor(agentAdapter.kind, agentAdapter.name, agentAdapter.handler);

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
if (!completed.final_output || completed.final_output.greeting !== 'Hello from mock agent!') {
  console.error('FAIL: missing or invalid final_output', JSON.stringify(completed.final_output));
  process.exit(1);
}

console.log('OK agent smoke — greeting:', completed.final_output.greeting);
