import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../data/db';
import type { OutboxRecord } from '../domain/types';
import { TimelinePage } from './TimelinePage';

const sync = vi.fn(async () => undefined);

vi.mock('../sync/SyncContext', () => ({
  useSync: () => ({ status: 'partial', detail: '还有 1 条内容等待同步', sync }),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ signOut: vi.fn(async () => undefined) }),
}));

function backedOffEntry(): OutboxRecord {
  return {
    operationId: '018f6b6a-7b03-7abc-8def-0123456789ab',
    entityType: 'entry',
    entityId: '018f6b6a-7b03-7abc-8def-0123456789ac',
    operation: 'soft_delete',
    baseVersion: '1',
    payload: {},
    createdAt: '2026-08-26T05:00:00.000Z',
    attempts: 4,
    nextAttemptAt: '2099-01-01T00:00:00.000Z',
    lastError: 'TEMPORARY_FAILURE',
  };
}

describe('timeline sync details', () => {
  afterEach(cleanup);

  beforeEach(async () => {
    sync.mockClear();
    await db.delete();
    await db.open();
    await db.outbox.put(backedOffEntry());
    await db.attachmentBlobs.put({
      id: '018f6b6a-7b03-7abc-8def-0123456789ad',
      draftId: '018f6b6a-7b03-7abc-8def-0123456789ae',
      blob: new Blob(['image'], { type: 'image/png' }),
      mimeType: 'image/png',
      originalFilename: '旅行照片.png',
      byteSize: 5,
      status: 'failed',
      createdAt: '2026-08-26T05:00:00.000Z',
      error: 'OSS CORS blocked',
    });
  });

  it('shows the pending type, error and an explicit retry action', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TimelinePage /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: '部分待同步' }));

    expect(await screen.findByRole('dialog', { name: '同步详情' })).toBeVisible();
    expect(screen.getByText('日记 · 删除')).toBeVisible();
    expect(screen.getByText('上次连接服务器失败（TEMPORARY_FAILURE）')).toBeVisible();
    expect(screen.getByText('图片 · 旅行照片.png')).toBeVisible();
    expect(screen.getByText('OSS CORS blocked')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '立即重试' }));
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('uses a branded mark and library icons for primary web actions', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TimelinePage /></MemoryRouter>);

    const brand = screen.getByRole('link', { name: '一本日记' });
    expect(brand.querySelector('svg[data-brand-mark]')).toBeInTheDocument();

    for (const name of ['搜索', '切换主题', '更多', '写新日记']) {
      expect(screen.getByRole('button', { name }).querySelector('svg[data-icon-name]')).toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.getByRole('link', { name: /日历/ }).querySelector('svg[data-icon-name="calendar"]')).toBeInTheDocument();
  });
});
