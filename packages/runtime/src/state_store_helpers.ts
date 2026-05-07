import { RunRecord, RunRecordLookup } from './state_store.js';

export function matchesConcurrencyLookup(record: RunRecord, lookup: RunRecordLookup): boolean {
  return record.sop_id === lookup.sop_id
    && record.sop_version === lookup.sop_version
    && record.concurrency_key === lookup.key;
}

export function compareRecordTime(left: RunRecord, right: RunRecord): number {
  return readRecordTime(left) - readRecordTime(right);
}

export function compareCompletedRecordTime(left: RunRecord, right: RunRecord): number {
  return readCompletedRecordTime(left) - readCompletedRecordTime(right);
}

export function readRecordTime(record: RunRecord): number {
  const timestamp = record.updated_at ?? record.created_at;
  if (timestamp === undefined) {
    return 0;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function readCompletedRecordTime(record: RunRecord): number {
  if (record.completed_at === undefined) {
    return 0;
  }

  const parsed = Date.parse(record.completed_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isCooldownActive(params: {
  record: RunRecord;
  cooldown_secs: number;
  now: string;
}): boolean {
  if (params.cooldown_secs <= 0 || params.record.completed_at === undefined) {
    return false;
  }

  const completedMs = Date.parse(params.record.completed_at);
  const nowMs = Date.parse(params.now);
  if (!Number.isFinite(completedMs) || !Number.isFinite(nowMs)) {
    return false;
  }

  return nowMs - completedMs < params.cooldown_secs * 1000;
}
