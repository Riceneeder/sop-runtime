import {expect, test} from 'bun:test';
import {createRun, buildStepPacket} from '@sop-runtime/core';
import {resolveExecutorConfigTemplate} from '../src/resolve_executor_config_template.js';
import {validateDefinition} from '@sop-runtime/validator';
import {readFileSync} from 'node:fs';

const definition = JSON.parse(readFileSync('examples/echo_sop_definition.json', 'utf8'));

test('resolve and immutable behavior', () => {
  const run = createRun({definition, input: {company:'Acme', request_id:'r1', ticket_id:'TICKET-1', workspace:'prod'}, runId:'r', now:new Date().toISOString()});
  const config = {message:'${run.input.company}', n:1, nested:[true, '${run.input.request_id}']};
  const resolved = resolveExecutorConfigTemplate({config, context:{run}});
  expect(resolved.message).toBe('Acme');
  expect((resolved.nested as unknown[])[1]).toBe('r1');
  expect(config.message).toBe('${run.input.company}');
});

test('throws on missing reference', () => {
  const run = createRun({definition, input: {company:'Acme', request_id:'r1', ticket_id:'TICKET-1', workspace:'prod'}, runId:'r', now:new Date().toISOString()});
  expect(() => resolveExecutorConfigTemplate({config:{x:'${run.input.missing}'}, context:{run}})).toThrow();
});

test('validator keeps executor config opaque and packet passthrough', () => {
  const v = validateDefinition(definition);
  expect(v.ok).toBe(true);
  const run = createRun({definition, input: {ticket_id:'TICKET-1', workspace:'prod'}, runId:'r', now:new Date().toISOString()});
  const packet = buildStepPacket({definition, state: run});
  expect(packet.executor.config?.message).toBe('${run.input.ticket_id}');
});
