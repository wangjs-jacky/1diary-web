import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxRecord } from '../domain/types';
import { apiRequest, uploadPresigned } from './api';
import { db } from './db';
import {
  partitionPushableRecords,
  pushOutbox,
  queueOperation,
  subscribeSyncStatus,
  syncNow,
} from './sync';

vi.mock('./api', () => ({
  apiRequest: vi.fn(),
  uploadPresigned: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);
const mockedUploadPresigned = vi.mocked(uploadPresigned);

function outboxRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    operationId: crypto.randomUUID(),
    entityType: 'entry',
    entityId: crypto.randomUUID(),
    operation: 'soft_delete',
    baseVersion: '1',
    payload: {},
    createdAt: '2026-08-25T00:00:00.000Z',
    attempts: 0,
    nextAttemptAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('offline outbox', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await db.delete();
    await db.open();
  });

  it('defers only operations that depend on a draft with failed images', () => {
    const draftUpsert = outboxRecord({ entityType: 'draft', entityId: 'failed-draft', operation: 'upsert' });
    const publish = outboxRecord({
      entityType: 'entry',
      operation: 'upsert',
      payload: { mode: 'publish', draftId: 'failed-draft' },
    });
    const unrelatedDelete = outboxRecord();

    const result = partitionPushableRecords(
      [draftUpsert, publish, unrelatedDelete],
      new Set(['failed-draft']),
    );
    expect(result.deferred).toEqual([draftUpsert, publish]);
    expect(result.pushable).toEqual([unrelatedDelete]);
  });

  it('continues pushing unrelated operations when an attachment upload fails', async () => {
    const now = new Date().toISOString();
    await db.attachmentBlobs.put({
      id: 'image-1',
      draftId: 'failed-draft',
      blob: new Blob(['image'], { type: 'image/png' }),
      mimeType: 'image/png',
      originalFilename: 'image.png',
      byteSize: 5,
      status: 'pending',
      createdAt: now,
    });
    const failedDraft = outboxRecord({ entityType: 'draft', entityId: 'failed-draft', operation: 'upsert' });
    const unrelatedDelete = outboxRecord();
    await db.outbox.bulkPut([failedDraft, unrelatedDelete]);

    mockedApiRequest.mockImplementation(async (path) => {
      if (path === '/attachments/prepare') {
        return { upload: { url: 'https://oss.example/upload', fields: {} } };
      }
      if (path === '/sync/push') {
        return {
          results: [{
            operationId: unrelatedDelete.operationId,
            entityType: unrelatedDelete.entityType,
            entityId: unrelatedDelete.entityId,
            status: 'applied',
            version: '2',
          }],
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });
    mockedUploadPresigned.mockRejectedValueOnce(new Error('OSS CORS blocked'));

    const summary = await pushOutbox('device-1');

    expect(summary.failedDraftIds).toEqual(new Set(['failed-draft']));
    const pushCall = mockedApiRequest.mock.calls.find(([path]) => path === '/sync/push');
    const pushBody = JSON.parse(String(pushCall?.[1]?.body));
    expect(pushBody.operations.map((item: OutboxRecord) => item.operationId))
      .toEqual([unrelatedDelete.operationId]);
    expect(await db.outbox.get(failedDraft.operationId)).toBeDefined();
    expect(await db.outbox.get(unrelatedDelete.operationId)).toBeUndefined();
    expect((await db.attachmentBlobs.get('image-1'))?.status).toBe('failed');
  });

  it('coalesces unsent autosaves for the same draft', async () => {
    const draftId = '018f6b6a-7b03-7abc-8def-0123456789ab';
    await queueOperation({
      entityType: 'draft',
      entityId: draftId,
      operation: 'upsert',
      baseVersion: '0',
      payload: { bodyMarkdown: '第一次输入' },
    });
    await queueOperation({
      entityType: 'draft',
      entityId: draftId,
      operation: 'upsert',
      baseVersion: '0',
      payload: { bodyMarkdown: '最后一次输入' },
    });
    const records = await db.outbox.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]?.payload).toEqual({ bodyMarkdown: '最后一次输入', expectedVersion: '0' });
    expect(records[0]?.operationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('queues a later draft version when an earlier autosave may already be on the server', async () => {
    const draftId = '018f6b6a-7b03-7abc-8def-0123456789ab';
    const first = await queueOperation({
      entityType: 'draft', entityId: draftId, operation: 'upsert', baseVersion: '0', payload: { expectedVersion: '0' },
    });
    await db.outbox.update(first.operationId, { attempts: 1 });
    await queueOperation({
      entityType: 'draft', entityId: draftId, operation: 'upsert', baseVersion: '0', payload: { expectedVersion: '0' },
    });
    await queueOperation({
      entityType: 'draft', entityId: draftId, operation: 'upsert', baseVersion: '0', payload: { expectedVersion: '0', bodyMarkdown: '更新后的内容' },
    });
    const records = await db.outbox.orderBy('createdAt').toArray();
    expect(records).toHaveLength(2);
    expect(records[1]?.baseVersion).toBe('1');
    expect(records[1]?.payload.expectedVersion).toBe('1');
    expect(records[1]?.payload.bodyMarkdown).toBe('更新后的内容');
  });

  it('does not add draft-only expectedVersion when coalescing entry publishes', async () => {
    const entryId = '018f6b6a-7b03-7abc-8def-0123456789ab';
    const draftId = '018f6b6a-7b03-7abc-8def-0123456789ac';
    const payload = {
      mode: 'publish',
      draftId,
      expectedDraftVersion: '1',
      tagLinks: [],
    };
    await queueOperation({
      entityType: 'entry', entityId: entryId, operation: 'upsert', baseVersion: '0', payload,
    });
    await queueOperation({
      entityType: 'entry', entityId: entryId, operation: 'upsert', baseVersion: '0', payload,
    });

    const records = await db.outbox.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]?.payload).toEqual(payload);
  });

  it('repairs legacy publish records before pushing them', async () => {
    const record = outboxRecord({
      entityType: 'entry',
      operation: 'upsert',
      payload: {
        mode: 'publish',
        draftId: '018f6b6a-7b03-7abc-8def-0123456789ac',
        expectedDraftVersion: '1',
        expectedVersion: '0',
        tagLinks: [],
      },
      attempts: 3,
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
    });
    await db.outbox.put(record);
    mockedApiRequest.mockImplementation(async (path) => {
      if (path === '/sync/push') {
        return {
          results: [{
            operationId: record.operationId,
            entityType: record.entityType,
            entityId: record.entityId,
            status: 'applied',
            version: '1',
          }],
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    await pushOutbox('device-1');

    const pushCall = mockedApiRequest.mock.calls.find(([path]) => path === '/sync/push');
    const pushBody = JSON.parse(String(pushCall?.[1]?.body));
    expect(pushBody.operations).toHaveLength(1);
    expect(pushBody.operations[0].payload).not.toHaveProperty('expectedVersion');
    expect(await db.outbox.get(record.operationId)).toBeUndefined();
  });

  it('does not report success while operations are still waiting for retry', async () => {
    await db.meta.put({ key: 'syncCursor', value: '0' });
    await db.outbox.put(outboxRecord({ nextAttemptAt: '2099-01-01T00:00:00.000Z' }));
    mockedApiRequest.mockImplementation(async (path) => {
      if (path === '/devices/register') return {};
      if (path.startsWith('/sync/pull')) {
        return { changes: [], nextCursor: '0', hasMore: false };
      }
      throw new Error(`unexpected path: ${path}`);
    });
    const events: Array<{ status: string; detail?: string }> = [];
    const unsubscribe = subscribeSyncStatus((event) => events.push(event));

    try {
      await syncNow();
    } finally {
      unsubscribe();
    }

    expect(events.at(-1)).toEqual({ status: 'partial', detail: '还有 1 条内容等待同步' });
  });
});
