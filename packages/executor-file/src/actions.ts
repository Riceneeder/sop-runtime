import { lstat, readFile, rename, copyFile, mkdir, unlink, writeFile as fsWriteFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildSuccessResult, buildToolErrorResult } from '@sop-runtime/adapter-core';
import { StepPacket } from '@sop-runtime/definition';
import { resolveSafePath, isNodeError } from './path-safety.js';

const READ_ENCODINGS = ['utf8', 'base64', 'hex'] as const;
const WRITE_ENCODINGS = ['utf8', 'base64'] as const;

// ─── Read ───────────────────────────────────────────────────────────────

export async function handleRead(
  packet: StepPacket,
  workspaceRoot: string,
  maxReadBytes: number,
  allowSymlinks: boolean,
): Promise<ReturnType<typeof buildSuccessResult | typeof buildToolErrorResult>> {
  const config = packet.executor.config ?? {};
  const rawPath = config.path;
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return buildToolErrorResult(packet, 'file_invalid_config', 'path is required for read');
  }
  const safe = await resolveSafePath(packet, rawPath, workspaceRoot, allowSymlinks);
  if ('status' in safe) return safe;
  const thePath = safe.path;

  let st;
  try {
    st = await lstat(thePath);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return buildToolErrorResult(packet, 'file_not_found', 'File not found', { path: thePath });
    }
    throw err;
  }
  if (!st.isFile()) {
    return buildToolErrorResult(packet, 'file_not_file', 'Path is not a regular file', { path: thePath });
  }
  if (st.size > maxReadBytes) {
    return buildToolErrorResult(
      packet, 'file_read_too_large',
      `File size (${st.size} bytes) exceeds maxFileReadBytes (${maxReadBytes})`,
      { path: thePath, size_bytes: st.size, max_bytes: maxReadBytes },
    );
  }
  const rawEncoding = typeof config.encoding === 'string' ? config.encoding : 'utf8';
  if (!READ_ENCODINGS.includes(rawEncoding as typeof READ_ENCODINGS[number])) {
    return buildToolErrorResult(packet, 'file_invalid_config', `Invalid encoding: ${rawEncoding}`);
  }
  const encoding = rawEncoding as typeof READ_ENCODINGS[number];
  let content: string;
  try {
    const raw = await readFile(thePath);
    content = encoding === 'utf8' ? new TextDecoder('utf-8', { fatal: true }).decode(raw)
      : encoding === 'base64' ? Buffer.from(raw).toString('base64')
      : Buffer.from(raw).toString('hex');
  } catch {
    return buildToolErrorResult(packet, 'file_read_failed', 'Failed to read file', { path: thePath });
  }
  return buildSuccessResult(packet, { path: thePath, encoding, size_bytes: st.size, content });
}

// ─── Write ──────────────────────────────────────────────────────────────

export async function handleWrite(
  packet: StepPacket,
  workspaceRoot: string,
  maxWriteBytes: number,
  allowWriteFlag: boolean,
  allowSymlinks: boolean,
): Promise<ReturnType<typeof buildSuccessResult | typeof buildToolErrorResult>> {
  if (!allowWriteFlag) {
    return buildToolErrorResult(packet, 'file_write_disabled', 'File write operations are disabled');
  }
  const config = packet.executor.config ?? {};
  const rawPath = config.path;
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return buildToolErrorResult(packet, 'file_invalid_config', 'path is required for write');
  }
  const safe = await resolveSafePath(packet, rawPath, workspaceRoot, allowSymlinks);
  if ('status' in safe) return safe;
  const targetPath = safe.path;

  const rawContent = config.content;
  const rawWriteEncoding = typeof config.write_encoding === 'string' ? config.write_encoding : 'utf8';
  if (!WRITE_ENCODINGS.includes(rawWriteEncoding as typeof WRITE_ENCODINGS[number])) {
    return buildToolErrorResult(packet, 'file_invalid_config', `Invalid write_encoding: ${rawWriteEncoding}`);
  }
  const writeEncoding = rawWriteEncoding as typeof WRITE_ENCODINGS[number];
  let contentBytes: Uint8Array;
  if (rawContent !== null && typeof rawContent === 'object' && !Array.isArray(rawContent)) {
    const jsonStr = JSON.stringify(rawContent);
    contentBytes = new TextEncoder().encode(jsonStr);
  } else if (typeof rawContent === 'string') {
    if (writeEncoding === 'base64') {
      contentBytes = Buffer.from(rawContent, 'base64');
    } else {
      contentBytes = new TextEncoder().encode(rawContent);
    }
  } else {
    return buildToolErrorResult(packet, 'file_invalid_config', 'content must be a string or object');
  }

  const overwrite = config.overwrite === true;
  try {
    await lstat(targetPath);
    if (!overwrite) {
      return buildToolErrorResult(
        packet, 'file_already_exists', 'File already exists and overwrite is not enabled',
        { path: targetPath },
      );
    }
  } catch {
    // File doesn't exist -- proceed
  }

  if (contentBytes.length > maxWriteBytes) {
    return buildToolErrorResult(
      packet, 'file_write_too_large',
      `Content size (${contentBytes.length} bytes) exceeds maxFileWriteBytes (${maxWriteBytes})`,
      { size_bytes: contentBytes.length, max_bytes: maxWriteBytes },
    );
  }

  try {
    await mkdir(dirname(targetPath), { recursive: true });
    await fsWriteFile(targetPath, contentBytes);
  } catch {
    return buildToolErrorResult(packet, 'file_write_failed', 'Failed to write file', { path: targetPath });
  }
  return buildSuccessResult(packet, { path: targetPath, size_bytes: contentBytes.length, written: true });
}

// ─── Copy ───────────────────────────────────────────────────────────────

export async function handleCopy(
  packet: StepPacket,
  workspaceRoot: string,
  allowWriteFlag: boolean,
  allowSymlinks: boolean,
): Promise<ReturnType<typeof buildSuccessResult | typeof buildToolErrorResult>> {
  if (!allowWriteFlag) {
    return buildToolErrorResult(packet, 'file_write_disabled', 'File write operations are disabled');
  }
  const config = packet.executor.config ?? {};
  const { source, destination } = config;
  if (typeof source !== 'string' || source.length === 0) {
    return buildToolErrorResult(packet, 'file_invalid_config', 'source is required for copy');
  }
  if (typeof destination !== 'string' || destination.length === 0) {
    return buildToolErrorResult(packet, 'file_invalid_config', 'destination is required for copy');
  }
  const srcSafe = await resolveSafePath(packet, source, workspaceRoot, allowSymlinks);
  if ('status' in srcSafe) return srcSafe;
  const dstSafe = await resolveSafePath(packet, destination, workspaceRoot, allowSymlinks);
  if ('status' in dstSafe) return dstSafe;
  const srcPath = srcSafe.path;
  const dstPath = dstSafe.path;

  const overwrite = config.overwrite === true;
  try {
    await lstat(dstPath);
    if (!overwrite) {
      return buildToolErrorResult(
        packet, 'file_already_exists', 'Destination already exists and overwrite is not enabled',
        { destination: dstPath },
      );
    }
  } catch {
    // Destination doesn't exist -- proceed
  }
  try {
    await mkdir(dirname(dstPath), { recursive: true });
    await copyFile(srcPath, dstPath);
  } catch (err: unknown) {
    return buildToolErrorResult(
      packet, 'file_copy_failed',
      `Failed to copy file: ${err instanceof Error ? err.message : String(err)}`,
      { source: srcPath, destination: dstPath },
    );
  }
  return buildSuccessResult(packet, { source: srcPath, destination: dstPath, copied: true });
}

// ─── Move ───────────────────────────────────────────────────────────────

export async function handleMove(
  packet: StepPacket,
  workspaceRoot: string,
  allowWriteFlag: boolean,
  allowDeleteFlag: boolean,
  allowSymlinks: boolean,
): Promise<ReturnType<typeof buildSuccessResult | typeof buildToolErrorResult>> {
  if (!allowWriteFlag) {
    return buildToolErrorResult(packet, 'file_write_disabled', 'File write operations are disabled');
  }
  if (!allowDeleteFlag) {
    return buildToolErrorResult(packet, 'file_delete_disabled', 'File delete operations are disabled');
  }
  const config = packet.executor.config ?? {};
  const { source, destination } = config;
  if (typeof source !== 'string' || source.length === 0) {
    return buildToolErrorResult(packet, 'file_invalid_config', 'source is required for move');
  }
  if (typeof destination !== 'string' || destination.length === 0) {
    return buildToolErrorResult(packet, 'file_invalid_config', 'destination is required for move');
  }
  const srcSafe = await resolveSafePath(packet, source, workspaceRoot, allowSymlinks);
  if ('status' in srcSafe) return srcSafe;
  const dstSafe = await resolveSafePath(packet, destination, workspaceRoot, allowSymlinks);
  if ('status' in dstSafe) return dstSafe;
  const srcPath = srcSafe.path;
  const dstPath = dstSafe.path;

  const overwrite = config.overwrite === true;
  try {
    await lstat(dstPath);
    if (!overwrite) {
      return buildToolErrorResult(
        packet, 'file_already_exists', 'Destination already exists and overwrite is not enabled',
        { destination: dstPath },
      );
    }
  } catch {
    // Destination doesn't exist -- proceed
  }
  try {
    await mkdir(dirname(dstPath), { recursive: true });
    await rename(srcPath, dstPath);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'EXDEV') {
      return buildToolErrorResult(
        packet, 'file_cross_device_move_not_supported',
        'Move across devices is not supported',
        { source: srcPath, destination: dstPath },
      );
    }
    return buildToolErrorResult(
      packet, 'file_move_failed',
      `Failed to move file: ${err instanceof Error ? err.message : String(err)}`,
      { source: srcPath, destination: dstPath },
    );
  }
  return buildSuccessResult(packet, { source: srcPath, destination: dstPath, moved: true });
}

// ─── Delete ─────────────────────────────────────────────────────────────

export async function handleDelete(
  packet: StepPacket,
  workspaceRoot: string,
  allowDeleteFlag: boolean,
  allowSymlinks: boolean,
): Promise<ReturnType<typeof buildSuccessResult | typeof buildToolErrorResult>> {
  if (!allowDeleteFlag) {
    return buildToolErrorResult(packet, 'file_delete_disabled', 'File delete operations are disabled');
  }
  const config = packet.executor.config ?? {};
  const rawPath = config.path;
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return buildToolErrorResult(packet, 'file_invalid_config', 'path is required for delete');
  }
  const safe = await resolveSafePath(packet, rawPath, workspaceRoot, allowSymlinks);
  if ('status' in safe) return safe;
  const targetPath = safe.path;

  let st;
  try {
    st = await lstat(targetPath);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return buildToolErrorResult(packet, 'file_not_found', 'File not found', { path: targetPath });
    }
    throw err;
  }
  if (st.isDirectory()) {
    return buildToolErrorResult(
      packet, 'file_delete_directory_not_supported', 'Cannot delete directories',
      { path: targetPath },
    );
  }
  try {
    await unlink(targetPath);
  } catch {
    return buildToolErrorResult(packet, 'file_delete_failed', 'Failed to delete file', { path: targetPath });
  }
  return buildSuccessResult(packet, { path: targetPath, deleted: true });
}
