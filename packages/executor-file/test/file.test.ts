import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileExecutor } from '../src/index.js';
import { ExecutorHandlerInput } from '@sop-runtime/adapter-core';
import { JsonObject, SopDefinition, RunState } from '@sop-runtime/definition';

let workspaceDir: string;
let realWorkspaceDir: string;

function makeInput(config: JsonObject): ExecutorHandlerInput {
  const definition: SopDefinition = {
    sop_id: 'test-sop',
    name: 'Test SOP',
    version: '1.0.0',
    entry_step: 's1',
    input_schema: { type: 'object' },
    policies: {
      cooldown_secs: 0,
      max_run_secs: 300,
      idempotency_key_template: '',
      concurrency: { mode: 'allow_parallel', key_template: '' },
    },
    steps: [],
    final_output: {},
  };
  const state: RunState = {
    run_id: 'test-run',
    sop_id: 'test-sop',
    sop_version: '1.0.0',
    status: 'running',
    phase: 'ready',
    run_input: {},
    entry_step_id: 's1',
    current_step_id: null,
    current_attempt: null,
    steps: {},
    accepted_results: {},
    history: [],
  };
  return {
    packet: {
      run_id: 'test-run',
      step_id: 'test-step',
      attempt: 1,
      inputs: { content: 'test-input' },
      executor: {
        kind: 'file',
        name: 'file',
        timeout_secs: 10,
        allow_network: false,
        env: {},
        resource_limits: { max_output_bytes: 1048576, max_artifacts: 0 },
        config,
      },
      output_schema: undefined,
    },
    definition,
    state,
    config: {},
  };
}

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'executor-file-test-'));
  realWorkspaceDir = await realpath(workspaceDir);
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

describe('createFileExecutor', () => {
  describe('path safety', () => {
    test('rejects path outside workspaceRoot', async () => {
      const executor = createFileExecutor({
        workspaceRoot: workspaceDir,
      });
      const input = makeInput({ action: 'read', path: '../../../etc/passwd' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('file_path_outside_workspace');
    });

    test('rejects absolute path', async () => {
      const executor = createFileExecutor({
        workspaceRoot: workspaceDir,
      });
      const input = makeInput({ action: 'read', path: '/etc/passwd' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('file_path_outside_workspace');
    });
  });

  describe('read', () => {
    test('reads file content', async () => {
      const fileContent = 'hello world';
      await writeFile(join(workspaceDir, 'hello.txt'), fileContent, 'utf-8');
      const executor = createFileExecutor({ workspaceRoot: workspaceDir });
      const input = makeInput({ action: 'read', path: 'hello.txt' });
      const result = await executor.handler(input);
      expect(result.status).toBe('success');
      expect(result.output).toEqual({
        path: join(realWorkspaceDir, 'hello.txt'),
        encoding: 'utf8',
        size_bytes: 11,
        content: 'hello world',
      });
    });

    test('read rejects non-existent file', async () => {
      const executor = createFileExecutor({ workspaceRoot: workspaceDir });
      const input = makeInput({ action: 'read', path: 'nonexistent.txt' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('file_not_found');
    });

    test('read rejects file larger than maxFileReadBytes', async () => {
      const largeContent = 'x'.repeat(100);
      await writeFile(join(workspaceDir, 'large.txt'), largeContent, 'utf-8');
      const executor = createFileExecutor({
        workspaceRoot: workspaceDir,
        maxFileReadBytes: 50,
      });
      const input = makeInput({ action: 'read', path: 'large.txt' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('file_read_too_large');
    });
  });

  describe('write', () => {
    test('rejects write when allowWrite is false', async () => {
      const executor = createFileExecutor({ workspaceRoot: workspaceDir });
      const input = makeInput({ action: 'write', path: 'test.txt', content: 'hello' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('file_write_disabled');
    });

    test('writes file content', async () => {
      const executor = createFileExecutor({
        workspaceRoot: workspaceDir,
        allowWrite: true,
      });
      const input = makeInput({ action: 'write', path: 'test.txt', content: 'hello world' });
      const result = await executor.handler(input);
      expect(result.status).toBe('success');
      expect(result.output).toEqual({
        path: join(realWorkspaceDir, 'test.txt'),
        size_bytes: 11,
        written: true,
      });

      const writtenContent = await readFile(join(workspaceDir, 'test.txt'), 'utf-8');
      expect(writtenContent).toBe('hello world');
    });

    test('write rejects existing file when overwrite=false', async () => {
      await writeFile(join(workspaceDir, 'existing.txt'), 'original', 'utf-8');
      const executor = createFileExecutor({
        workspaceRoot: workspaceDir,
        allowWrite: true,
      });
      const input = makeInput({ action: 'write', path: 'existing.txt', content: 'new content' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('file_already_exists');
    });

    test('write creates parent directories', async () => {
      const executor = createFileExecutor({
        workspaceRoot: workspaceDir,
        allowWrite: true,
      });
      const input = makeInput({ action: 'write', path: 'a/b/c/nested.txt', content: 'nested' });
      const result = await executor.handler(input);
      expect(result.status).toBe('success');

      const fileContent = await readFile(join(workspaceDir, 'a', 'b', 'c', 'nested.txt'), 'utf-8');
      expect(fileContent).toBe('nested');
    });
  });

  describe('copy', () => {
    test('copy creates copy of file', async () => {
      await writeFile(join(workspaceDir, 'source.txt'), 'source content', 'utf-8');
      const executor = createFileExecutor({
        workspaceRoot: workspaceDir,
        allowWrite: true,
      });
      const input = makeInput({ action: 'copy', source: 'source.txt', destination: 'dest.txt' });
      const result = await executor.handler(input);
      expect(result.status).toBe('success');
      expect(result.output).toEqual({
        source: join(realWorkspaceDir, 'source.txt'),
        destination: join(realWorkspaceDir, 'dest.txt'),
        copied: true,
      });

      const destContent = await readFile(join(workspaceDir, 'dest.txt'), 'utf-8');
      expect(destContent).toBe('source content');
    });
  });

  describe('move', () => {
    test('move requires allowWrite', async () => {
      await writeFile(join(workspaceDir, 'source.txt'), 'content', 'utf-8');
      // allowWrite defaults to false, so move fails
      const executor = createFileExecutor({
        workspaceRoot: workspaceDir,
      });
      const input = makeInput({ action: 'move', source: 'source.txt', destination: 'dest.txt' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('file_write_disabled');
    });

    test('move requires allowDelete', async () => {
      await writeFile(join(workspaceDir, 'source.txt'), 'content', 'utf-8');
      // allowWrite is true but allowDelete is false → move fails
      const executor = createFileExecutor({
        workspaceRoot: workspaceDir,
        allowWrite: true,
        allowDelete: false,
      });
      const input = makeInput({ action: 'move', source: 'source.txt', destination: 'dest.txt' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('file_delete_disabled');
    });
  });

  describe('delete', () => {
    test('delete removes file', async () => {
      await writeFile(join(workspaceDir, 'todelete.txt'), 'bye', 'utf-8');
      const executor = createFileExecutor({
        workspaceRoot: workspaceDir,
        allowDelete: true,
      });
      const input = makeInput({ action: 'delete', path: 'todelete.txt' });
      const result = await executor.handler(input);
      expect(result.status).toBe('success');
      expect(result.output).toEqual({
        path: join(realWorkspaceDir, 'todelete.txt'),
        deleted: true,
      });

      const exists = await Bun.file(join(workspaceDir, 'todelete.txt')).exists();
      expect(exists).toBe(false);
    });

    test('delete rejects directory', async () => {
      await mkdir(join(workspaceDir, 'adir'), { recursive: true });
      const executor = createFileExecutor({
        workspaceRoot: workspaceDir,
        allowDelete: true,
      });
      const input = makeInput({ action: 'delete', path: 'adir' });
      const result = await executor.handler(input);
      expect(result.status).toBe('tool_error');
      expect(result.error?.code).toBe('file_delete_directory_not_supported');
    });
  });
});
