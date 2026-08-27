const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ATTACHMENT_PATTERN = /!\[([^\]]*)\]\(attachment:\/\/([^)]+)\)(?:\{width=(\d+)%\})?/g;

export type AttachmentMarkdownToken = {
  id: string;
  alt: string;
  widthPercent: number;
};

type SerializeAttachmentInput = {
  id: string;
  alt?: string;
  widthPercent?: number;
};

export function clampImageWidth(value?: number) {
  return Math.min(100, Math.max(20, Number.isFinite(value) ? Math.round(value!) : 100));
}

export function parseAttachmentMarkdown(markdown: string): AttachmentMarkdownToken[] {
  return [...markdown.matchAll(ATTACHMENT_PATTERN)].map((match) => ({
    id: match[2]!,
    alt: match[1] ?? '',
    widthPercent: clampImageWidth(match[3] ? Number(match[3]) : 100),
  }));
}

export function serializeAttachmentMarkdown({
  id,
  alt = '',
  widthPercent = 100,
}: SerializeAttachmentInput) {
  const safeAlt = alt.replace(/[\[\]\r\n]/g, ' ').trim();
  return `![${safeAlt}](attachment://${id}){width=${clampImageWidth(widthPercent)}%}`;
}

function inlineToHtml(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

export function markdownToHtml(
  markdown: string,
  attachmentUrls: ReadonlyMap<string, string> = new Map(),
) {
  return markdown
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((block) => {
      const image = /^!\[([^\]]*)\]\(attachment:\/\/([^)]+)\)(?:\{width=(\d+)%\})?$/.exec(block);
      if (image) {
        const [, caption, id, widthValue] = image;
        const widthPercent = clampImageWidth(widthValue ? Number(widthValue) : 100);
        const url = attachmentUrls.get(id!);
        const safeUrl = url && /^(?:https?:|blob:)/i.test(url) ? url : '';
        return `<figure data-attachment-id="${escapeHtml(id!)}" data-image-width="${widthPercent}" style="width:${widthPercent}%;max-width:100%">${
          safeUrl
            ? `<img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(caption!)}">`
            : '<div class="image-placeholder">图片离线缓存不可用</div>'
        }<figcaption>${escapeHtml(caption || '图片')}</figcaption></figure>`;
      }
      const heading = /^(#{1,4})\s+(.+)$/.exec(block);
      if (heading) {
        const level = heading[1]!.length;
        return `<h${level}>${inlineToHtml(heading[2]!)}</h${level}>`;
      }
      if (block.startsWith('> ')) {
        return `<blockquote>${inlineToHtml(block.slice(2)).replace(/\n/g, '<br>')}</blockquote>`;
      }
      const lines = block.split('\n');
      if (lines.every((line) => /^- \[(?: |x|X)\]\s/.test(line))) {
        return `<ul data-type="taskList">${lines.map((line) => {
          const task = /^- \[([ xX])\]\s(.*)$/.exec(line)!;
          const checked = task[1]!.toLocaleLowerCase() === 'x';
          return `<li data-type="taskItem" data-checked="${checked}"><label contenteditable="false"><input type="checkbox"${checked ? ' checked' : ''} disabled><span></span></label><div><p>${inlineToHtml(task[2]!)}</p></div></li>`;
        }).join('')}</ul>`;
      }
      if (lines.every((line) => line.startsWith('- '))) {
        return `<ul>${lines.map((line) => `<li>${inlineToHtml(line.slice(2))}</li>`).join('')}</ul>`;
      }
      if (lines.every((line) => /^\d+\.\s/.test(line))) {
        return `<ol>${lines.map((line) => `<li>${inlineToHtml(line.replace(/^\d+\.\s/, ''))}</li>`).join('')}</ol>`;
      }
      return `<p>${inlineToHtml(block).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

function inlineToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  if (node.tagName === 'BR') return '\n';
  const value = [...node.childNodes].map(inlineToMarkdown).join('');
  if (node.matches('b,strong')) return `**${value}**`;
  if (node.matches('i,em')) return `*${value}*`;
  if (node.matches('code')) return `\`${value}\``;
  return value;
}

export function htmlToMarkdown(root: HTMLElement) {
  return [...root.childNodes]
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent?.trim() ?? '';
      if (!(node instanceof HTMLElement)) return '';
      const text = inlineToMarkdown(node).trim();
      if (node.matches('h1,h2,h3,h4')) {
        const level = Number(node.tagName.slice(1));
        return `${'#'.repeat(level)} ${text}`;
      }
      if (node.matches('blockquote')) return `> ${text}`;
      if (node.matches('ul,ol')) {
        if (node.matches('ul[data-type="taskList"]')) {
          return [...node.querySelectorAll(':scope > li[data-type="taskItem"]')]
            .map((item) => {
              const checked = item.getAttribute('data-checked') === 'true'
                || item.querySelector('input[type="checkbox"]')?.hasAttribute('checked');
              const content = item.querySelector(':scope > div') ?? item;
              return `- [${checked ? 'x' : ' '}] ${inlineToMarkdown(content).trim()}`;
            })
            .join('\n');
        }
        const ordered = node.matches('ol');
        return [...node.querySelectorAll(':scope > li')]
          .map((item, index) => `${ordered ? `${index + 1}.` : '-'} ${inlineToMarkdown(item).trim()}`)
          .join('\n');
      }
      if (node.matches('figure')) {
        const id = node.dataset.attachmentId;
        if (!id) return '';
        const caption = node.querySelector('figcaption')?.textContent?.trim() || '图片';
        return serializeAttachmentMarkdown({
          id,
          alt: caption,
          widthPercent: Number(node.dataset.imageWidth || 100),
        });
      }
      return text;
    })
    .filter(Boolean)
    .join('\n\n');
}

export function visibleText(markdown: string) {
  return markdown
    .replace(ATTACHMENT_PATTERN, '')
    .replace(/[#>*_`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(markdown: string) {
  return [...visibleText(markdown).replace(/\s/g, '')].length;
}

export function firstHeading(markdown: string) {
  const heading = /^#{1,4}\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  return heading || '';
}
