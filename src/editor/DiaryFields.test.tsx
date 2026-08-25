import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '../domain/types';
import { DiaryFields } from './DiaryFields';

const category = (id: string, name: string): Category => ({
  id,
  name,
  sortOrder: 0,
  version: '1',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  deletedAt: null,
});

describe('DiaryFields', () => {
  afterEach(cleanup);

  it('opens an accessible calendar and category list', async () => {
    const user = userEvent.setup();
    const onCategoryChange = vi.fn();
    render(
      <DiaryFields
        journalDate="2026-08-25"
        journalTime="16:59"
        categoryId=""
        categories={[category('work', '工作')]}
        onDateChange={vi.fn()}
        onTimeChange={vi.fn()}
        onCategoryChange={onCategoryChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /选择日期/ }));
    expect(await screen.findByRole('dialog')).toBeVisible();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: /选择分类/ }));
    await user.click(await screen.findByRole('option', { name: '工作' }));
    expect(onCategoryChange).toHaveBeenCalledWith('work');
  });
});
