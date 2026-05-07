import { lstat, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, basename, join } from 'node:path';
import { buildToolErrorResult } from '@sop-runtime/adapter-core';
import { StepPacket } from '@sop-runtime/definition';

/**
 * Check if an error is a Node.js system error with a code property.
 */
export function isNodeError(err: unknown): err is { code?: string; message: string } {
  return err instanceof Error && 'code' in err;
}

/**
 * Resolve a user-provided path safely within the workspace root.
 *
 * Rules:
 * 1. Path must be relative (reject absolute).
 * 2. Resolve against workspaceRoot and verify it doesn't escape via `..`.
 * 3. For existing paths: check symlinks, realpath, and re-verify within root.
 * 4. For non-existing paths: verify parent directory is within root.
 */
export async function resolveSafePath(
  packet: StepPacket,
  rawPath: string,
  workspaceRoot: string,
  allowSymlinks: boolean,
): Promise<{ path: string } | ReturnType<typeof buildToolErrorResult>> {
  if (rawPath.includes('\0')) {
    return buildToolErrorResult(
      packet, 'file_invalid_config', 'Path contains NUL byte',
      { path: rawPath },
    );
  }
  if (rawPath.startsWith('/')) {
    return buildToolErrorResult(
      packet, 'file_path_outside_workspace', 'Absolute paths are not allowed',
      { path: rawPath },
    );
  }
  const resolved = resolve(workspaceRoot, rawPath);
  const rel = relative(workspaceRoot, resolved);
  if (rel.startsWith('..')) {
    return buildToolErrorResult(
      packet, 'file_path_outside_workspace', 'Path is outside workspace root',
      { path: rawPath, resolved },
    );
  }

  // Check intermediate path components for symlinks when symlinks are disabled
  if (!allowSymlinks) {
    const segments = rawPath.split('/').filter(Boolean);
    let partial = workspaceRoot;
    for (const seg of segments) {
      partial = resolve(partial, seg);
      try {
        const st = await lstat(partial);
        if (st.isSymbolicLink()) {
          return buildToolErrorResult(
            packet, 'file_symlink_not_allowed',
            `Symlinks are not allowed (component "${seg}" in "${rawPath}" is a symlink)`,
            { path: rawPath, symlinkComponent: seg },
          );
        }
      } catch (err: unknown) {
        if (isNodeError(err) && err.code === 'ENOENT') break;
        // Don't throw on errors for intermediate paths, just stop checking
        break;
      }
    }
  }

  try {
    const lst = await lstat(resolved);
    if (lst.isSymbolicLink() && !allowSymlinks) {
      return buildToolErrorResult(
        packet, 'file_symlink_not_allowed', 'Symlinks are not allowed',
        { path: rawPath },
      );
    }
    const real = await realpath(resolved);
    const relReal = relative(workspaceRoot, real);
    if (relReal.startsWith('..')) {
      return buildToolErrorResult(
        packet, 'file_path_outside_workspace', 'Symlink target is outside workspace root',
        { path: rawPath, real },
      );
    }
    return { path: real };
  } catch (err: unknown) {
    if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
    return resolveNonExistingParent(packet, resolved, workspaceRoot, allowSymlinks);
  }
}

async function resolveNonExistingParent(
  packet: StepPacket,
  resolvedPath: string,
  workspaceRoot: string,
  allowSymlinks: boolean,
): Promise<{ path: string } | ReturnType<typeof buildToolErrorResult>> {
  // Walk up until we find an existing component
  const segments: string[] = [];
  let current = resolvedPath;
  while (true) {
    try {
      await lstat(current);
      break;
    } catch (err: unknown) {
      if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
      segments.unshift(basename(current));
      current = dirname(current);
      if (current === dirname(current)) {
        return buildToolErrorResult(
          packet, 'file_not_found', 'Path does not exist within workspace root',
          { path: resolvedPath },
        );
      }
    }
  }
  try {
    const lst = await lstat(current);
    if (lst.isSymbolicLink() && !allowSymlinks) {
      return buildToolErrorResult(
        packet, 'file_symlink_not_allowed', 'Symlinks are not allowed in path',
        { path: resolvedPath },
      );
    }
    const realCurrent = await realpath(current);
    const relCurrent = relative(workspaceRoot, realCurrent);
    if (relCurrent.startsWith('..')) {
      return buildToolErrorResult(
        packet, 'file_path_outside_workspace', 'Path escapes workspace root via symlink',
        { path: resolvedPath, realCurrent },
      );
    }
    const reconstructed = join(realCurrent, ...segments);
    const relReconstructed = relative(workspaceRoot, reconstructed);
    if (relReconstructed.startsWith('..')) {
      return buildToolErrorResult(
        packet, 'file_path_outside_workspace', 'Reconstructed path escapes workspace root',
        { path: resolvedPath, reconstructed },
      );
    }
    return { path: reconstructed };
  } catch {
    return buildToolErrorResult(
      packet, 'file_not_found', 'Parent directory does not exist',
      { path: resolvedPath },
    );
  }
}
