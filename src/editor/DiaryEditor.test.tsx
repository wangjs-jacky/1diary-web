import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiaryEditor, type DiaryEditorHandle } from './DiaryEditor';

describe('DiaryEditor', () => {
  afterEach(cleanup);

  it('makes formatting state visible and lets the same button cancel it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DiaryEditor
        value="普通正文"
        attachmentUrls={new Map()}
        onChange={onChange}
        onPasteImage={vi.fn()}
      />,
    );

    const editor = screen.getByRole('textbox', { name: '日记正文' });
    await user.click(editor);
    await user.click(screen.getByRole('button', { name: '加粗' }));
    expect(screen.getByRole('button', { name: '加粗' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '加粗' }));
    expect(screen.getByRole('button', { name: '加粗' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('persists attachment width presets in Markdown', async () => {
    const user = userEvent.setup();
    const ref = createRef<DiaryEditorHandle>();
    const onChange = vi.fn();
    render(
      <DiaryEditor
        ref={ref}
        value=""
        attachmentUrls={new Map()}
        onChange={onChange}
        onPasteImage={vi.fn()}
      />,
    );

    ref.current?.insertAttachment({ id: 'image-1', src: 'blob:image-1', alt: '日记图片' });
    fireEvent.click(await screen.findByRole('img', { name: '日记图片' }));
    await user.click(screen.getByRole('button', { name: '图片宽度 50%' }));

    await waitFor(() => {
      expect(ref.current?.getMarkdown()).toContain(
        '![日记图片](attachment://image-1){width=50%}',
      );
    });
  });

  it('hands pasted image files to the page', () => {
    const onPasteImage = vi.fn();
    render(
      <DiaryEditor
        value=""
        attachmentUrls={new Map()}
        onChange={vi.fn()}
        onPasteImage={onPasteImage}
      />,
    );
    const file = new File(['image'], 'pasted.png', { type: 'image/png' });
    fireEvent.paste(screen.getByRole('textbox', { name: '日记正文' }), {
      clipboardData: { files: [file], getData: () => '' },
    });
    expect(onPasteImage).toHaveBeenCalledWith(file);
  });
});
