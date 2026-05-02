import {expect} from 'bun:test';
import {StepResult} from '@sop-runtime/definition';
import {RuntimeStepPacket} from './index.js';

export function buildPacket(overrides: Partial<RuntimeStepPacket> = {}): RuntimeStepPacket {
  const base: RuntimeStepPacket = {
    'run_id': 'run_001',
    'step_id': 'step_a',
    'attempt': 1,
    'inputs': {
      'company': 'Acme',
      'count': 2,
      'enabled': true,
      'nested': {'value': 'ok'},
      'missing': null,
    },
    'executor': {
      'kind': 'sandbox_tool',
      'tool': 'demo_tool',
      'command_template': 'do ${company} ${nested.value} ${missing} ${unknown}',
      'path': '/tmp',
      'timeout_secs': 1,
      'allow_network': false,
      'env': {},
      'resource_limits': {
        'max_output_bytes': 1024,
        'max_artifacts': 2,
      },
    },
    'output_schema': {
      'type': 'object',
    },
  };
  return {
    ...base,
    ...overrides,
    'executor': {
      ...base.executor,
      ...overrides.executor,
      'resource_limits': {
        ...base.executor.resource_limits,
        ...overrides.executor?.resource_limits,
      },
    },
  };
}

export function expectResultIdentity(result: StepResult, packet: RuntimeStepPacket): void {
  expect(result.run_id).toBe(packet.run_id);
  expect(result.step_id).toBe(packet.step_id);
  expect(result.attempt).toBe(packet.attempt);
}
