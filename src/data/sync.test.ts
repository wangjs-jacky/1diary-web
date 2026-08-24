import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { queueOperation } from './sync';

describe('offline outbox', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
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
});
