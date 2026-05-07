import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildToolErrorResult, ExecutorAdapter, ExecutorHandlerInput } from '@sop-runtime/adapter-core';
import { StepPacket } from '@sop-runtime/definition';
import { handleRead, handleWrite, handleCopy, handleMove, handleDelete } from './actions.js';

/**
 * Options for configuring the file executor adapter.
 */
export interface FileExecutorOptions {
  workspaceRoot: string;
  maxFileReadBytes?: number;
  maxFileWriteBytes?: number;
  allowWrite?: boolean;
  allowDelete?: boolean;
  allowSymlinks?: boolean;
}

// Default limits
const ONE_MB = 1_048_576;

/**
 * Create a file executor adapter that reads/writes/copies/moves/deletes
 * files within a workspace root.
 *
 * @param options - File executor options.
 * @returns An ExecutorAdapter for the file executor.
 */
export function createFileExecutor(options: FileExecutorOptions): ExecutorAdapter {
  const initialRoot = resolve(options.workspaceRoot);
  const maxReadBytes = options.maxFileReadBytes ?? ONE_MB;
  const maxWriteBytes = options.maxFileWriteBytes ?? ONE_MB;
  const allowWrite = options.allowWrite ?? false;
  const allowDelete = options.allowDelete ?? false;
  const allowSymlinks = options.allowSymlinks ?? false;

  let realRootPromise: Promise<string> | undefined;

  async function getRealRoot(): Promise<string> {
    if (realRootPromise === undefined) {
      realRootPromise = realpath(initialRoot);
    }
    return realRootPromise;
  }

  return {
    kind: 'file',
    name: 'file',
    description: 'Reads/writes/copies/moves/deletes files within the workspace root',
    handler: async (input: ExecutorHandlerInput) => {
      const workspaceRoot = await getRealRoot();
      const packet = input.packet as StepPacket;
      const config = packet.executor.config ?? {};
      const action = config.action;
      if (typeof action !== 'string') {
        return buildToolErrorResult(
          packet, 'file_invalid_config', `Invalid action: ${String(action)}`,
        );
      }
      if (!['read', 'write', 'copy', 'move', 'delete'].includes(action)) {
        return buildToolErrorResult(
          packet, 'file_invalid_config', `Invalid action: ${action}`,
          { action },
        );
      }
      switch (action) {
        case 'read':
          return handleRead(packet, workspaceRoot, maxReadBytes, allowSymlinks);
        case 'write':
          return handleWrite(packet, workspaceRoot, maxWriteBytes, allowWrite, allowSymlinks);
        case 'copy':
          return handleCopy(packet, workspaceRoot, allowWrite, allowSymlinks);
        case 'move':
          return handleMove(packet, workspaceRoot, allowWrite, allowDelete, allowSymlinks);
        case 'delete':
          return handleDelete(packet, workspaceRoot, allowDelete, allowSymlinks);
        default:
          return buildToolErrorResult(
            packet, 'file_invalid_config', `Invalid action: ${action}`,
          );
      }
    },
  };
}
