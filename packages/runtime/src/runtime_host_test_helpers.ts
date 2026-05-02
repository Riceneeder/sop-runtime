import { expect } from 'bun:test';
import { Decision, JsonObject, SopDefinition } from '@sop-runtime/definition';
import {
  DecisionProvider,
  DefaultDecisionProvider,
  EventSink,
  ExecutorHandler,
  InMemoryStateStore,
  RuntimeError,
  RuntimeEvent,
  RuntimeHost,
} from './index.js';

export interface PacketSnapshot {
  run_id: string;
  step_id: string;
  attempt: number;
  inputs: JsonObject;
  executor: {
    kind: string;
    name: string;
    config?: JsonObject;
    timeout_secs: number;
    allow_network: boolean;
    env: Record<string, string>;
    resource_limits: { max_output_bytes: number; max_artifacts: number };
  };
}

export class FixedClock {
  private current: string;

  constructor(now: string) {
    this.current = now;
  }

  now(): string {
    return this.current;
  }

  setNow(now: string): void {
    this.current = now;
  }
}

export class SequentialIdGenerator {
  private next = 1;

  newRunId(): string {
    const id = `run_${String(this.next).padStart(3, '0')}`;
    this.next += 1;
    return id;
  }
}

export function recordingExecutor(): { handler: ExecutorHandler; packets: PacketSnapshot[] } {
  const packets: PacketSnapshot[] = [];
  const handler: ExecutorHandler = (input) => {
    packets.push({
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'inputs': input.packet.inputs,
      'executor': input.packet.executor,
    });
    return {
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'status': 'success',
      'output': {
        'summary': `summary for ${String(input.packet.inputs.company)}`,
      },
      'artifacts': {
        'report_md': `/tmp/${input.packet.run_id}.md`,
      },
    };
  };
  return { handler, packets };
}

export function clockAdvancingExecutor(clock: FixedClock, nextNow: string): { handler: ExecutorHandler; packets: PacketSnapshot[] } {
  const packets: PacketSnapshot[] = [];
  const handler: ExecutorHandler = (input) => {
    packets.push({
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'inputs': input.packet.inputs,
      'executor': input.packet.executor,
    });
    clock.setNow(nextNow);
    return {
      'run_id': input.packet.run_id,
      'step_id': input.packet.step_id,
      'attempt': input.packet.attempt,
      'status': 'success',
      'output': { 'summary': 'summary after deadline' },
      'artifacts': { 'report_md': `/tmp/${input.packet.run_id}.md` },
    };
  };
  return { handler, packets };
}

export class ClockAdvancingDecisionProvider implements DecisionProvider {
  constructor(
    private readonly clock: FixedClock,
    private readonly nextNow: string,
  ) { }

  async decide(input: Parameters<DecisionProvider['decide']>[0]): Promise<Decision> {
    this.clock.setNow(this.nextNow);
    return {
      'run_id': input.state.run_id,
      'step_id': input.accepted_result.step_id,
      'attempt': input.accepted_result.attempt,
      'outcome_id': 'done',
      'reason': 'selected after deadline',
    };
  }
}

export class RecordingEventSink implements EventSink {
  readonly events: RuntimeEvent[] = [];

  emit(event: RuntimeEvent): void {
    this.events.push(event);
  }
}

function buildBaseStep(): SopDefinition['steps'][number] {
  return {
    'id': 'step_a',
    'title': 'A',
    'inputs': { 'company': '${run.input.company}' },
    'executor': {
      'kind': 'tool',
      'name': 'default_tool',
      'config': { 'command_template': 'run', 'path': '/tmp' },
      'timeout_secs': 120,
      'allow_network': true,
      'env': {},
      'resource_limits': { 'max_output_bytes': 1024, 'max_artifacts': 1 },
    },
    'output_schema': {
      'type': 'object',
      'required': ['summary'],
      'properties': { 'summary': { 'type': 'string' } },
    },
    'retry_policy': { 'max_attempts': 1, 'backoff_secs': [], 'retry_on': [] },
    'supervision': {
      'owner': 'main_agent',
      'allowed_outcomes': [{ 'id': 'done', 'description': 'done' }],
      'default_outcome': 'done',
    },
    'transitions': {
      'done': { 'terminate': { 'run_status': 'succeeded', 'reason': 'complete' } },
    },
  } as SopDefinition['steps'][number];
}

function buildBaseDefinition(): SopDefinition {
  return {
    'sop_id': 'runtime_report',
    'name': 'Runtime Report',
    'version': '1.0.0',
    'entry_step': 'step_a',
    'input_schema': {
      'type': 'object',
      'required': ['company'],
      'properties': { 'company': { 'type': 'string' } },
      'additionalProperties': false,
    },
    'policies': {
      'cooldown_secs': 0,
      'max_run_secs': 60,
      'idempotency_key_template': 'report:${run.input.company}',
      'concurrency': {
        'mode': 'singleflight',
        'key_template': 'report:${run.input.company}',
      },
    },
    'steps': [buildBaseStep()],
    'final_output': {
      'summary': '${steps.step_a.output.summary}',
      'artifact': '${steps.step_a.artifacts.report_md}',
    },
  };
}

export function buildDefinition(overrides: Partial<SopDefinition['policies']> = {}): SopDefinition {
  return {
    ...buildBaseDefinition(),
    'policies': {
      ...buildBaseDefinition().policies,
      ...overrides,
    },
  };
}

export function buildHost(overrides: {
  clock?: FixedClock;
  idGenerator?: SequentialIdGenerator;
  decisionProvider?: DecisionProvider;
  eventSink?: RecordingEventSink;
} = {}): { host: RuntimeHost; store: InMemoryStateStore } {
  const store = new InMemoryStateStore();
  const host = new RuntimeHost({
    store,
    'decisionProvider': overrides.decisionProvider ?? new DefaultDecisionProvider(),
    'clock': overrides.clock ?? new FixedClock('2026-04-20T12:00:00.000Z'),
    'idGenerator': overrides.idGenerator ?? new SequentialIdGenerator(),
    'eventSink': overrides.eventSink,
  });
  return { host, store };
}

export function registerDefaultExecutor(host: RuntimeHost): { packets: PacketSnapshot[] } {
  const { handler, packets } = recordingExecutor();
  host.registerExecutor('tool', 'default_tool', handler);
  return { packets };
}

export async function expectRuntimeErrorCode(
  action: () => Promise<unknown>,
  code: RuntimeError['code'],
): Promise<RuntimeError> {
  let runtimeError: unknown;
  try {
    await action();
  } catch (caught) {
    runtimeError = caught;
  }

  expect(runtimeError).toBeInstanceOf(RuntimeError);
  expect((runtimeError as RuntimeError).code).toBe(code);
  return runtimeError as RuntimeError;
}

export function buildDefinitionWithExecutor(
  executor: Partial<SopDefinition['steps'][number]['executor']>,
): SopDefinition {
  const definition = buildDefinition();
  const step = definition.steps[0]!;
  return {
    ...definition,
    'steps': [{
      ...step,
      'executor': {
        ...step.executor,
        ...executor,
      },
    }],
  };
}
