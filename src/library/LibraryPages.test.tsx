import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../data/db';
import type { Entry } from '../domain/types';
import { CalendarPage } from './LibraryPages';

function entryFor(date: string): Entry {
  return {
    id: '018f6b6a-7b03-7abc-8def-012345678901',
    categoryId: null,
    bodyMarkdown: '# 今天',
    journalDate: date,
    journalTime: '10:30:00.000',
    timezoneId: 'Asia/Shanghai',
    publishedAt: `${date}T02:30:00.000Z`,
    version: '1',
    createdAt: `${date}T02:30:00.000Z`,
    updatedAt: `${date}T02:30:00.000Z`,
    deletedAt: null,
  };
}

describe('CalendarPage', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('uses the accessible calendar component, icon navigation and entry counts', async () => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await db.entries.put(entryFor(date));

    render(<MemoryRouter><CalendarPage /></MemoryRouter>);

    expect(await screen.findByText('1 篇')).toBeVisible();
    expect(screen.getByRole('button', { name: '上个月' }).querySelector('svg[data-icon-name="previous-month"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下个月' }).querySelector('svg[data-icon-name="next-month"]')).toBeInTheDocument();
    expect(document.querySelector('.journal-calendar')).toBeInTheDocument();
  });
});
