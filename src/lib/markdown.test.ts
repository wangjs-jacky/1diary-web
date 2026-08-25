import { describe, expect, it } from 'vitest';
import {
  htmlToMarkdown,
  markdownToHtml,
  parseAttachmentMarkdown,
  serializeAttachmentMarkdown,
  visibleText,
  wordCount,
} from './markdown';

describe('markdown editor conversion', () => {
  it('renders the supported basic markdown without exposing raw HTML', () => {
    const html = markdownToHtml('## 今天\n\n这是 **重要** 的事。\n\n- 第一项\n- 第二项');
    expect(html).toContain('<h2>今天</h2>');
    expect(html).toContain('<strong>重要</strong>');
    expect(html).toContain('<li>第一项</li>');
    expect(html).not.toContain('<script>');
  });

  it('round-trips inline attachment references', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h2>散步</h2><p>今天很好。</p><figure data-attachment-id="abc"><img src="blob:x"><figcaption>江边</figcaption></figure>';
    expect(htmlToMarkdown(root)).toBe('## 散步\n\n今天很好。\n\n![江边](attachment://abc){width=100%}');
  });

  it('parses and serializes persisted attachment widths', () => {
    expect(parseAttachmentMarkdown('![江边](attachment://abc){width=50%}')).toEqual([
      { id: 'abc', alt: '江边', widthPercent: 50 },
    ]);
    expect(parseAttachmentMarkdown('![旧图片](attachment://legacy)')).toEqual([
      { id: 'legacy', alt: '旧图片', widthPercent: 100 },
    ]);
    expect(serializeAttachmentMarkdown({ id: 'abc', alt: '江边', widthPercent: 75 }))
      .toBe('![江边](attachment://abc){width=75%}');
  });

  it('clamps attachment widths before rendering them', () => {
    const urls = new Map([['abc', 'blob:image']]);
    expect(markdownToHtml('![图片](attachment://abc)', urls)).toContain('width:100%');
    expect(markdownToHtml('![图片](attachment://abc){width=5%}', urls)).toContain('width:20%');
    expect(markdownToHtml('![图片](attachment://abc){width=500%}', urls)).toContain('width:100%');
  });

  it('saves plain text typed directly into an empty contenteditable', () => {
    const root = document.createElement('div');
    root.append('直接开始写作');
    expect(htmlToMarkdown(root)).toBe('直接开始写作');
  });

  it('does not count image metadata as diary text', () => {
    const markdown = '## 标题\n\n正文\n\n![很长的图片说明](attachment://abc)';
    expect(visibleText(markdown)).toBe('标题 正文');
    expect(wordCount(markdown)).toBe(4);
  });

  it('only renders trusted attachment URL schemes', () => {
    const urls = new Map([['abc', 'javascript:alert(1)']]);
    const html = markdownToHtml('![图片](attachment://abc)', urls);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('图片离线缓存不可用');
  });
});
