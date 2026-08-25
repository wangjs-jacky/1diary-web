import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { clampImageWidth } from '../lib/markdown';

export type AttachmentImageAttributes = {
  attachmentId: string;
  src: string;
  alt: string;
  widthPercent: number;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    attachmentImage: {
      insertAttachmentImage: (attributes: AttachmentImageAttributes) => ReturnType;
    };
  }
}

function AttachmentImageView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const widthPercent = clampImageWidth(Number(node.attrs.widthPercent));
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const figure = event.currentTarget.closest('figure');
    const container = figure?.parentElement;
    if (!figure || !container) return;
    const startX = event.clientX;
    const startWidth = figure.getBoundingClientRect().width;
    const containerWidth = container.getBoundingClientRect().width || startWidth;

    function move(pointerEvent: PointerEvent) {
      const next = clampImageWidth(((startWidth + pointerEvent.clientX - startX) / containerWidth) * 100);
      setDragWidth(next);
    }

    function finish(pointerEvent: PointerEvent) {
      const next = clampImageWidth(((startWidth + pointerEvent.clientX - startX) / containerWidth) * 100);
      updateAttributes({ widthPercent: next });
      setDragWidth(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
  }

  const renderedWidth = dragWidth ?? widthPercent;
  return (
    <NodeViewWrapper
      as="figure"
      className={`attachment-image${selected ? ' is-selected' : ''}`}
      data-attachment-id={node.attrs.attachmentId}
      data-image-width={renderedWidth}
      style={{ width: `${renderedWidth}%` }}
      onClick={() => {
        const position = getPos();
        if (typeof position === 'number') editor.commands.setNodeSelection(position);
      }}
    >
      <img src={node.attrs.src} alt={node.attrs.alt || '日记图片'} draggable={false} />
      <figcaption contentEditable={false}>{node.attrs.alt || '日记图片'}</figcaption>
      {selected && (
        <button
          type="button"
          className="image-resize-handle"
          aria-label="拖动调整图片尺寸"
          contentEditable={false}
          onPointerDown={startResize}
        />
      )}
    </NodeViewWrapper>
  );
}

export const AttachmentImage = Node.create({
  name: 'attachmentImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      attachmentId: { default: '' },
      src: { default: '' },
      alt: { default: '日记图片' },
      widthPercent: { default: 100 },
    };
  },

  parseHTML() {
    return [{
      tag: 'figure[data-attachment-id]',
      getAttrs: (element) => {
        const figure = element as HTMLElement;
        const image = figure.querySelector('img');
        return {
          attachmentId: figure.dataset.attachmentId || '',
          src: image?.getAttribute('src') || '',
          alt: image?.getAttribute('alt') || figure.querySelector('figcaption')?.textContent || '日记图片',
          widthPercent: clampImageWidth(Number(figure.dataset.imageWidth || 100)),
        };
      },
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const widthPercent = clampImageWidth(Number(HTMLAttributes.widthPercent));
    return [
      'figure',
      mergeAttributes({
        'data-attachment-id': HTMLAttributes.attachmentId,
        'data-image-width': widthPercent,
        style: `width:${widthPercent}%;max-width:100%`,
      }),
      ['img', { src: HTMLAttributes.src, alt: HTMLAttributes.alt }],
      ['figcaption', {}, HTMLAttributes.alt || '日记图片'],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentImageView);
  },

  addCommands() {
    return {
      insertAttachmentImage: (attributes: AttachmentImageAttributes) => ({ commands }) =>
        commands.insertContent([
          { type: this.name, attrs: { ...attributes, widthPercent: clampImageWidth(attributes.widthPercent) } },
          { type: 'paragraph' },
        ]),
    };
  },
});
