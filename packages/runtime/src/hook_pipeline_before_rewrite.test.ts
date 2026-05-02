import { describe, expect, test } from 'bun:test';
import { JsonObject } from '@sop-runtime/definition';
import {
  DefaultDecisionProvider,
  InMemoryStateStore,
  RuntimeHost,
} from './index.js';
import {
  buildDefinition,
  buildDefinitionWithExecutor,
  FixedClock,
  PacketSnapshot,
  SequentialIdGenerator,
} from './runtime_host_test_helpers.js';

describe('hook pipeline — beforeStep rewrite', () => {
  test('beforeStep can rewrite inputs and executor receives them', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(input) => {
          return {
            'inputs': { ...input.packet.inputs as JsonObject, 'company': 'Rewritten' },
          };
        }],
      },
    });
    let receivedInputs: JsonObject = {};
    host.registerExecutor('tool', 'default_tool', (input) => {
      receivedInputs = input.packet.inputs;
      return {
        'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
        'attempt': input.packet.attempt, 'status': 'success',
        'output': { 'summary': 'ok' },
      };
    });

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    await host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id });

    expect(receivedInputs.company).toBe('Rewritten');
  });

  test('beforeStep can rewrite executor config and handler receives it', async () => {
    const store = new InMemoryStateStore();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(input) => {
          return {
            'config': { ...(input.packet.executor.config as JsonObject ?? {}), 'command_template': 'rewritten_cmd' },
          };
        }],
      },
    });
    let receivedConfig: JsonObject = {};
    host.registerExecutor('tool', 'default_tool', (input) => {
      receivedConfig = input.config;
      return {
        'run_id': input.packet.run_id, 'step_id': input.packet.step_id,
        'attempt': input.packet.attempt, 'status': 'success',
        'output': { 'summary': 'ok' },
      };
    });

    const started = await host.startRun({ 'definition': buildDefinition(), 'input': { 'company': 'Acme' } });
    await host.runReadyStep({ 'definition': buildDefinition(), 'runId': started.state.run_id });

    expect(receivedConfig.command_template).toBe('rewritten_cmd');
  });

  test('hook mutations to definition do not affect core state transitions or output validation', async () => {
    const store = new InMemoryStateStore();
    const definition = buildDefinition();
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(input) => {
          const step = input.definition.steps[0]!;
          step.output_schema = {
            'type': 'object',
            'required': ['missing'],
            'properties': { 'missing': { 'type': 'string' } },
          };
          step.supervision.allowed_outcomes = [{ 'id': 'mutated', 'description': 'mutated' }];
          step.supervision.default_outcome = 'mutated';
          step.transitions = {
            'mutated': {
              'terminate': {
                'run_status': 'failed',
                'reason': 'mutated definition leaked',
              },
            },
          };
        }],
      },
    });
    host.registerExecutor('tool', 'default_tool', (input) => ({
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'status': 'success',
      'output': { 'summary': 'still valid' },
      'artifacts': { 'report_md': '/tmp/still-valid.md' },
    }));

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
    const completed = await host.runUntilComplete({ definition, 'runId': started.state.run_id });

    expect(completed.state.status).toBe('succeeded');
    expect(completed.final_output?.summary).toBe('still valid');
  });

  test('hook mutations to packet executor internals do not affect executor dispatch', async () => {
    const store = new InMemoryStateStore();
    const definition = buildDefinitionWithExecutor({
      'config': { 'command_template': 'run', 'path': '/tmp' },
      'env': { 'TOKEN': 'original' },
      'resource_limits': {
        'max_output_bytes': 2048,
        'max_artifacts': 2,
      },
    });
    const host = new RuntimeHost({
      store,
      'decisionProvider': new DefaultDecisionProvider(),
      'clock': new FixedClock('2026-04-20T12:00:00.000Z'),
      'idGenerator': new SequentialIdGenerator(),
      'hooks': {
        'beforeStep': [(input) => {
          input.packet.executor.env.TOKEN = 'mutated';
          input.packet.executor.resource_limits.max_output_bytes = 1;
          const config = input.packet.executor.config;
          if (config !== undefined) {
            config.command_template = 'mutated';
          }
        }],
        'afterStep': [(input) => {
          input.packet.executor.env.TOKEN = 'mutated_after';
          input.packet.executor.resource_limits.max_artifacts = 99;
        }],
      },
    });
    const receivedExecutors: PacketSnapshot['executor'][] = [];
    host.registerExecutor('tool', 'default_tool', (input) => {
      receivedExecutors.push(input.packet.executor);
      return {
        'run_id': input.packet.run_id,
        'step_id': input.packet.step_id,
        'attempt': input.packet.attempt,
        'status': 'success',
        'output': { 'summary': 'ok' },
      };
    });

    const started = await host.startRun({ definition, 'input': { 'company': 'Acme' } });
    await host.runReadyStep({ definition, 'runId': started.state.run_id });

    const receivedExecutor = receivedExecutors[0];
    expect(receivedExecutor?.config?.command_template).toBe('run');
    expect(receivedExecutor?.env.TOKEN).toBe('original');
    expect(receivedExecutor?.resource_limits.max_output_bytes).toBe(2048);
    expect(receivedExecutor?.resource_limits.max_artifacts).toBe(2);
  });
});
