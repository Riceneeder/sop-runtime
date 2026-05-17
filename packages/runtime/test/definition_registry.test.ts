import { describe, expect, test } from 'bun:test';
import { DefinitionRegistry } from '../src/definition_registry.js';
import { SopDefinition } from '@sop-runtime/definition';

function makeDef(overrides?: Partial<SopDefinition>): SopDefinition {
  return {
    sop_id: 'test-sop',
    version: '1.0.0',
    name: 'Test SOP',
    description: 'A test SOP definition',
    entry_step: 'step_a',
    input_schema: { type: 'object', properties: {}, required: [] },
    policies: {
      cooldown_secs: 0,
      max_run_secs: 60,
      idempotency_key_template: 'test',
      concurrency: { mode: 'allow_parallel', key_template: 'test' },
    },
    steps: [],
    final_output: {},
    ...overrides,
  } as unknown as SopDefinition;
}

describe('DefinitionRegistry', () => {
  test('register and resolve by exact sop_id + version', () => {
    const registry = new DefinitionRegistry();
    const def = makeDef();
    registry.register(def);

    const resolved = registry.resolve('test-sop', '1.0.0');
    expect(resolved).not.toBeNull();
    expect(resolved!.sop_id).toBe('test-sop');
    expect(resolved!.version).toBe('1.0.0');
  });

  test('resolve returns null for unknown sop_id', () => {
    const registry = new DefinitionRegistry();
    expect(registry.resolve('nonexistent', '1.0.0')).toBeNull();
  });

  test('resolve without version returns the latest', () => {
    const registry = new DefinitionRegistry();
    registry.register(makeDef({ version: '1.0.0' }));
    registry.register(makeDef({ sop_id: 'test-sop', version: '2.0.0' }));

    const resolved = registry.resolve('test-sop');
    expect(resolved).not.toBeNull();
    expect(resolved!.version).toBe('2.0.0');
  });

  test('resolve returns null when no definition registered for sop_id', () => {
    const registry = new DefinitionRegistry();
    registry.register(makeDef({ sop_id: 'other-sop', version: '1.0.0' }));

    expect(registry.resolve('test-sop')).toBeNull();
  });

  test('list returns all registered definitions', () => {
    const registry = new DefinitionRegistry();
    registry.register(makeDef({ sop_id: 'sop-a', version: '1.0.0' }));
    registry.register(makeDef({ sop_id: 'sop-b', version: '1.0.0' }));

    const all = registry.list();
    expect(all.length).toBe(2);
  });

  test('list returns empty array for empty registry', () => {
    const registry = new DefinitionRegistry();
    expect(registry.list()).toEqual([]);
  });

  test('remove by exact sop_id + version returns true and removes', () => {
    const registry = new DefinitionRegistry();
    registry.register(makeDef());

    const removed = registry.remove('test-sop', '1.0.0');
    expect(removed).toBeTrue();
    expect(registry.resolve('test-sop', '1.0.0')).toBeNull();
  });

  test('remove by sop_id only removes all versions', () => {
    const registry = new DefinitionRegistry();
    registry.register(makeDef({ version: '1.0.0' }));
    registry.register(makeDef({ version: '2.0.0' }));

    const removed = registry.remove('test-sop');
    expect(removed).toBeTrue();
    expect(registry.list().length).toBe(0);
  });

  test('remove returns false for non-existent definition', () => {
    const registry = new DefinitionRegistry();
    expect(registry.remove('nonexistent', '1.0.0')).toBeFalse();
  });

  test('register overwrites existing definition with same sop_id and version', () => {
    const registry = new DefinitionRegistry();
    registry.register(makeDef({ name: 'Original' }));
    registry.register(makeDef({ name: 'Updated' }));

    const resolved = registry.resolve('test-sop', '1.0.0');
    expect(resolved!.name).toBe('Updated');
  });

  test('resolve returns a clone (immutability)', () => {
    const registry = new DefinitionRegistry();
    registry.register(makeDef());

    const resolved = registry.resolve('test-sop', '1.0.0')!;
    resolved.name = 'Modified';

    const resolvedAgain = registry.resolve('test-sop', '1.0.0')!;
    expect(resolvedAgain.name).toBe('Test SOP');
  });
});
