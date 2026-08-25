import type { Table } from 'dexie';
import type {
  Attachment,
  BootstrapResponse,
  Category,
  Draft,
  DraftAttachmentRef,
  DraftTag,
  EntityKind,
  Entry,
  EntryTag,
  OutboxRecord,
  PullResponse,
  SyncChange,
  SyncOperation,
  SyncResult,
  SyncStatus,
  Tag,
} from '../domain/types';
import { getDeviceId, newId } from '../lib/ids';
import { apiRequest, uploadPresigned } from './api';
import { db } from './db';

const syncEvents = new EventTarget();
let status: SyncStatus = navigator.onLine ? 'idle' : 'offline';
let running: Promise<void> | null = null;

function setStatus(next: SyncStatus, detail?: string) {
  status = next;
  syncEvents.dispatchEvent(new CustomEvent('status', { detail: { status: next, detail } }));
}

export function getSyncStatus() {
  return status;
}

export function subscribeSyncStatus(
  listener: (value: { status: SyncStatus; detail?: string }) => void,
) {
  const handler = (event: Event) => listener((event as CustomEvent).detail);
  syncEvents.addEventListener('status', handler);
  return () => syncEvents.removeEventListener('status', handler);
}

const tableByKind: Record<EntityKind, Table<Record<string, unknown>, string>> = {
  category: db.categories as unknown as Table<Record<string, unknown>, string>,
  tag: db.tags as unknown as Table<Record<string, unknown>, string>,
  entry: db.entries as unknown as Table<Record<string, unknown>, string>,
  draft: db.drafts as unknown as Table<Record<string, unknown>, string>,
  entry_tag: db.entryTags as unknown as Table<Record<string, unknown>, string>,
  draft_tag: db.draftTags as unknown as Table<Record<string, unknown>, string>,
  attachment: db.attachments as unknown as Table<Record<string, unknown>, string>,
  draft_attachment_ref: db.draftAttachmentRefs as unknown as Table<Record<string, unknown>, string>,
};

async function applyChange(change: SyncChange) {
  const table = tableByKind[change.entityType];
  if (change.operation === 'purge') {
    await table.delete(change.entityId);
    return;
  }
  await table.put(change.payload);
}

async function applyBootstrap(response: BootstrapResponse) {
  const pendingEntryIds = new Set((await db.outbox.toArray()).map((item) => item.entityId));
  const optimisticEntries = (await db.entries.toArray()).filter((entry) => pendingEntryIds.has(entry.id));
  const optimisticDrafts = (await db.drafts.toArray()).filter((draft) => pendingEntryIds.has(draft.id));
  await db.transaction(
    'rw',
    [
      db.categories,
      db.tags,
      db.entries,
      db.drafts,
      db.entryTags,
      db.draftTags,
      db.attachments,
      db.draftAttachmentRefs,
      db.meta,
    ],
    async () => {
      await Promise.all([
        db.categories.clear(),
        db.tags.clear(),
        db.entries.clear(),
        db.drafts.clear(),
        db.entryTags.clear(),
        db.draftTags.clear(),
        db.attachments.clear(),
        db.draftAttachmentRefs.clear(),
      ]);
      await Promise.all([
        db.categories.bulkPut(response.data.categories),
        db.tags.bulkPut(response.data.tags),
        db.entries.bulkPut([...response.data.entries, ...optimisticEntries]),
        db.drafts.bulkPut([...response.data.drafts, ...optimisticDrafts]),
        db.entryTags.bulkPut(response.data.entryTags),
        db.draftTags.bulkPut(response.data.draftTags),
        db.attachments.bulkPut(response.data.attachments),
        db.draftAttachmentRefs.bulkPut(response.data.draftAttachmentRefs),
        db.meta.put({ key: 'syncCursor', value: response.baselineCursor }),
      ]);
    },
  );
}

export async function queueOperation(
  operation: Omit<SyncOperation, 'operationId'> & { operationId?: string },
) {
  const pending = await db.outbox
    .where('entityId')
    .equals(operation.entityId)
    .filter((item) => item.entityType === operation.entityType && item.operation === operation.operation)
    .sortBy('createdAt');
  const existing = [...pending].reverse().find((item) => item.attempts === 0);
  const now = new Date().toISOString();
  const predecessor = pending.at(-1);
  const followsAttemptedDraft =
    !existing &&
    predecessor?.attempts &&
    operation.entityType === 'draft' &&
    operation.operation === 'upsert';
  const predictedBase = existing?.baseVersion ?? (followsAttemptedDraft
    ? (BigInt(predecessor.baseVersion) + 1n).toString()
    : operation.baseVersion);
  const payload = existing || followsAttemptedDraft
    ? { ...operation.payload, expectedVersion: predictedBase }
    : operation.payload;
  const record: OutboxRecord = {
    ...operation,
    baseVersion: predictedBase,
    payload,
    operationId: existing?.operationId ?? operation.operationId ?? newId(),
    createdAt: existing?.createdAt ?? now,
    attempts: 0,
    nextAttemptAt: now,
  };
  await db.outbox.put(record);
  return record;
}

async function registerDevice() {
  const deviceId = getDeviceId();
  await apiRequest('/devices/register', {
    method: 'POST',
    body: JSON.stringify({
      id: deviceId,
      platform: 'web',
      deviceName: navigator.platform || 'Web browser',
      appVersion: '0.1.0',
    }),
  });
  return deviceId;
}

export interface AttachmentUploadSummary {
  failedAttachmentIds: Set<string>;
  failedDraftIds: Set<string>;
  errors: string[];
}

export async function uploadPendingAttachments(): Promise<AttachmentUploadSummary> {
  const summary: AttachmentUploadSummary = {
    failedAttachmentIds: new Set(),
    failedDraftIds: new Set(),
    errors: [],
  };
  const pending = await db.attachmentBlobs.where('status').anyOf('pending', 'failed').toArray();
  for (const item of pending) {
    await db.attachmentBlobs.update(item.id, { status: 'uploading', error: undefined });
    try {
      const prepared = await apiRequest<{
        upload: { url: string; fields: Record<string, string> };
      }>('/attachments/prepare', {
        method: 'POST',
        body: JSON.stringify({
          id: item.id,
          draftId: item.draftId,
          mimeType: item.mimeType,
          byteSize: item.byteSize,
          ...(item.originalFilename ? { originalFilename: item.originalFilename } : {}),
        }),
      });
      await uploadPresigned(prepared.upload.url, prepared.upload.fields, item.blob);
      await apiRequest(`/attachments/${item.id}/complete`, { method: 'POST' });
      await db.attachmentBlobs.update(item.id, { status: 'ready' });
      await db.attachments.update(item.id, { remoteState: 'ready' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传失败';
      await db.attachmentBlobs.update(item.id, {
        status: 'failed',
        error: message,
      });
      summary.failedAttachmentIds.add(item.id);
      summary.failedDraftIds.add(item.draftId);
      summary.errors.push(message);
    }
  }
  return summary;
}

function dependsOnFailedAttachment(record: OutboxRecord, failedDraftIds: ReadonlySet<string>) {
  if (record.entityType === 'draft' && failedDraftIds.has(record.entityId)) return true;
  return record.entityType === 'entry'
    && record.operation === 'upsert'
    && record.payload.mode === 'publish'
    && typeof record.payload.draftId === 'string'
    && failedDraftIds.has(record.payload.draftId);
}

export function partitionPushableRecords(
  records: OutboxRecord[],
  failedDraftIds: ReadonlySet<string>,
) {
  const pushable: OutboxRecord[] = [];
  const deferred: OutboxRecord[] = [];
  for (const record of records) {
    (dependsOnFailedAttachment(record, failedDraftIds) ? deferred : pushable).push(record);
  }
  return { pushable, deferred };
}

export async function pushOutbox(deviceId: string) {
  const uploadSummary = await uploadPendingAttachments();
  const now = new Date().toISOString();
  const records = (await db.outbox.orderBy('createdAt').toArray())
    .filter((item) => item.nextAttemptAt <= now)
    .slice(0, 100);
  const { pushable } = partitionPushableRecords(records, uploadSummary.failedDraftIds);
  if (!pushable.length) return uploadSummary;
  await db.outbox.bulkPut(
    pushable.map((item) => ({
      ...item,
      attempts: item.attempts + 1,
      nextAttemptAt: new Date(Date.now() + Math.min(60_000, 2 ** (item.attempts + 1) * 1_000)).toISOString(),
    })),
  );
  const response = await apiRequest<{ results: SyncResult[] }>('/sync/push', {
    method: 'POST',
    body: JSON.stringify({
      deviceId,
      operations: pushable.map(({ createdAt: _, attempts: __, nextAttemptAt: ___, lastError: ____, ...operation }) => operation),
    }),
  });
  for (const result of response.results) {
    const record = pushable.find((item) => item.operationId === result.operationId);
    if (!record) continue;
    if (result.status === 'applied' || result.status === 'conflict' || result.status === 'rejected') {
      await db.outbox.delete(record.operationId);
      if (result.version) await tableByKind[result.entityType].update(result.entityId, { version: result.version });
      if (result.status === 'rejected' && (result.entityType === 'entry' || result.entityType === 'draft')) {
        await tableByKind[result.entityType].update(result.entityId, { syncError: result.code || '同步被拒绝' });
      }
      continue;
    }
    const attempts = record.attempts + 1;
    await db.outbox.update(record.operationId, {
      attempts,
      nextAttemptAt: new Date(Date.now() + Math.min(60_000, 2 ** attempts * 1_000)).toISOString(),
      lastError: result.code || 'TEMPORARY_FAILURE',
    });
  }
  return uploadSummary;
}

async function pullChanges(deviceId: string) {
  const storedCursor = (await db.meta.get('syncCursor'))?.value;
  let cursor: string;
  if (storedCursor === undefined) {
    const bootstrap = await apiRequest<BootstrapResponse>('/sync/bootstrap', {}, { 'x-device-id': deviceId });
    await applyBootstrap(bootstrap);
    cursor = bootstrap.baselineCursor;
  } else {
    cursor = storedCursor;
  }
  let hasMore = true;
  while (hasMore) {
    const response: PullResponse = await apiRequest<PullResponse>(
      `/sync/pull?cursor=${encodeURIComponent(cursor)}&limit=500`,
      {},
      { 'x-device-id': deviceId },
    );
    await db.transaction(
      'rw',
      [
        db.categories,
        db.tags,
        db.entries,
        db.drafts,
        db.entryTags,
        db.draftTags,
        db.attachments,
        db.draftAttachmentRefs,
        db.meta,
      ],
      async () => {
        for (const change of response.changes) await applyChange(change);
        await db.meta.put({ key: 'syncCursor', value: response.nextCursor });
      },
    );
    cursor = response.nextCursor;
    hasMore = response.hasMore;
  }
}

async function performSync() {
  if (!navigator.onLine) {
    setStatus('offline');
    return;
  }
  setStatus('syncing');
  try {
    const deviceId = await registerDevice();
    const uploadSummary = await pushOutbox(deviceId);
    await pullChanges(deviceId);
    if (uploadSummary.errors.length) {
      const count = uploadSummary.failedAttachmentIds.size;
      setStatus('partial', `${count} 张图片待重试，其他内容已同步`);
    } else {
      setStatus('idle');
    }
  } catch (error) {
    setStatus(navigator.onLine ? 'error' : 'offline', error instanceof Error ? error.message : '同步失败');
  }
}

export function syncNow() {
  if (!running) running = performSync().finally(() => (running = null));
  return running;
}

export function startAutoSync() {
  const online = () => void syncNow();
  const offline = () => setStatus('offline');
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  const timer = window.setInterval(() => void syncNow(), 45_000);
  void syncNow();
  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    window.clearInterval(timer);
  };
}

export type BootstrapEntity =
  | Category
  | Tag
  | Entry
  | Draft
  | EntryTag
  | DraftTag
  | Attachment
  | DraftAttachmentRef;
