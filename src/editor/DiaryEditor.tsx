import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Braces,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Undo2,
} from 'lucide-react';
import { forwardRef, useImperativeHandle } from 'react';
import { htmlToMarkdown, markdownToHtml } from '../lib/markdown';
import { AttachmentImage } from './AttachmentImage';

export type DiaryEditorHandle = {
  getMarkdown(): string;
  insertAttachment(attributes: { id: string; src: string; alt: string; widthPercent?: number }): void;
  focus(): void;
};

type DiaryEditorProps = {
  value: string;
  attachmentUrls: ReadonlyMap<string, string>;
  onChange(markdown: string): void;
  onPasteImage(file: File): void;
};

export function editorHtmlToMarkdown(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return htmlToMarkdown(root);
}

type ToolbarButtonProps = {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
};

function ToolbarButton({ label, active = false, disabled = false, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className="editor-toolbar-button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export const DiaryEditor = forwardRef<DiaryEditorHandle, DiaryEditorProps>(function DiaryEditor(
  { value, attachmentUrls, onChange, onPasteImage },
  ref,
) {
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ heading: { levels: [2] } }),
      Placeholder.configure({ placeholder: '写下今天发生的事…' }),
      AttachmentImage,
    ],
    content: markdownToHtml(value, attachmentUrls),
    onUpdate: ({ editor: current }) => onChange(editorHtmlToMarkdown(current.getHTML())),
    editorProps: {
      attributes: {
        class: 'rich-editor ProseMirror',
        role: 'textbox',
        'aria-label': '日记正文',
        'aria-multiline': 'true',
      },
    },
  });

  useImperativeHandle(ref, () => ({
    getMarkdown: () => editor ? editorHtmlToMarkdown(editor.getHTML()) : value,
    insertAttachment: (attributes) => {
      editor?.chain().focus().insertAttachmentImage({
        attachmentId: attributes.id,
        src: attributes.src,
        alt: attributes.alt,
        widthPercent: attributes.widthPercent ?? 100,
      }).run();
    },
    focus: () => editor?.commands.focus(),
  }), [editor, value]);

  if (!editor) return <div className="rich-editor loading" aria-label="正在加载编辑器" />;

  const tools = [
    { label: '正文', active: editor.isActive('paragraph'), icon: <Pilcrow />, run: () => editor.chain().focus().setParagraph().run() },
    { label: '二级标题', active: editor.isActive('heading', { level: 2 }), icon: <Heading2 />, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: '加粗', active: editor.isActive('bold'), icon: <Bold />, run: () => editor.chain().focus().toggleBold().run() },
    { label: '斜体', active: editor.isActive('italic'), icon: <Italic />, run: () => editor.chain().focus().toggleItalic().run() },
    { label: '无序列表', active: editor.isActive('bulletList'), icon: <List />, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '有序列表', active: editor.isActive('orderedList'), icon: <ListOrdered />, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: '引用', active: editor.isActive('blockquote'), icon: <Quote />, run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: '行内代码', active: editor.isActive('code'), icon: <Braces />, run: () => editor.chain().focus().toggleCode().run() },
  ];

  return (
    <div className="diary-editor">
      <div className="editor-toolbar" role="toolbar" aria-label="文字格式">
        {tools.map((tool) => (
          <ToolbarButton key={tool.label} label={tool.label} active={tool.active} onClick={tool.run}>
            {tool.icon}
          </ToolbarButton>
        ))}
        <span className="toolbar-divider" />
        <ToolbarButton label="撤销" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 /></ToolbarButton>
        <ToolbarButton label="重做" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 /></ToolbarButton>
        <ToolbarButton label="清除格式" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting /></ToolbarButton>
        <span className="toolbar-divider" />
        <span className="image-width-label">图片</span>
        {[25, 50, 75, 100].map((size) => (
          <button
            key={size}
            type="button"
            className="image-width-button"
            aria-label={`图片宽度 ${size}%`}
            aria-pressed={editor.isActive('attachmentImage', { widthPercent: size })}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().updateAttributes('attachmentImage', { widthPercent: size }).run()}
          >
            {size}%
          </button>
        ))}
      </div>
      <EditorContent
        editor={editor}
        onPaste={(event) => {
          const file = [...event.clipboardData.files].find((item) => item.type.startsWith('image/'));
          if (!file) return;
          event.preventDefault();
          onPasteImage(file);
        }}
      />
    </div>
  );
});
