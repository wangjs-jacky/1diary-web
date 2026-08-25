import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../data/api';
import { db } from '../data/db';
import { queueOperation, syncNow } from '../data/sync';
import type { Attachment, Draft, Entry } from '../domain/types';
import { newId } from '../lib/ids';
import { parseAttachmentMarkdown, visibleText, wordCount } from '../lib/markdown';
import { formatDiaryDate, localJournalTime } from '../lib/time';
import { DiaryEditor, type DiaryEditorHandle } from './DiaryEditor';

const ALLOWED_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

type EditorMode = 'new' | 'edit';
type DetailAttachment = Pick<Attachment, 'id' | 'mimeType' | 'originalFilename' | 'width' | 'height' | 'sortOrder' | 'version' | 'createdAt' | 'updatedAt'> & {
  byteSize: number | null;
  url: string | null;
};

const emptyAudit = (now: string) => ({ version: '0', createdAt: now, updatedAt: now, deletedAt: null });

export function EditorPage({ mode }: { mode: EditorMode }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const editorRef = useRef<DiaryEditorHandle>(null);
  const markdownRef = useRef('');
  const saveTimer = useRef<number | null>(null);
  const activeDraft = useRef<Draft | null>(null);
  const objectUrls = useRef<string[]>([]);
  const initializedFields = useRef(false);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState('已保存到本地');
  const [count, setCount] = useState(0);
  const [categoryId, setCategoryId] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagPicker, setTagPicker] = useState(false);
  const [editorValue, setEditorValue] = useState('');
  const [attachmentUrls, setAttachmentUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const initialTime = localJournalTime();
  const [journalDate, setJournalDate] = useState(initialTime.journalDate);
  const [journalTime, setJournalTime] = useState(initialTime.journalTime.slice(0, 5));
  const [message, setMessage] = useState('');

  const categories = useLiveQuery(() => db.categories.filter((item) => !item.deletedAt).sortBy('sortOrder'), [], []);
  const tags = useLiveQuery(() => db.tags.filter((item) => !item.deletedAt).sortBy('name'), [], []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    initializedFields.current = false;
    activeDraft.current = null;
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    async function load() {
      const now = new Date().toISOString();
      let draft: Draft | undefined;
      let entry: Entry | undefined;
      if (mode === 'new') {
        draft = await db.drafts.get(id);
      } else {
        entry = await db.entries.get(id);
        draft = await db.drafts.where('baseEntryId').equals(id).filter((item) => !item.deletedAt).first();
        if (!entry) {
          navigate('/', { replace: true });
          return;
        }
      }
      if (!draft) {
        const temporal = entry
          ? { journalDate: entry.journalDate, journalTime: entry.journalTime, timezoneId: entry.timezoneId }
          : localJournalTime();
        const tagRows = entry ? await db.entryTags.where('entryId').equals(entry.id).filter((item) => !item.deletedAt).toArray() : [];
        const attachmentRows = entry ? await db.attachments.where('entryId').equals(entry.id).filter((item) => !item.deletedAt).toArray() : [];
        draft = {
          id: mode === 'new' ? id : newId(),
          kind: mode === 'new' ? 'new' : 'edit',
          baseEntryId: entry?.id ?? null,
          publishedEntryId: null,
          categoryId: entry?.categoryId ?? null,
          bodyMarkdown: entry?.bodyMarkdown ?? '',
          ...temporal,
          baseVersion: entry?.version ?? null,
          conflictReason: null,
          lastAutosavedAt: now,
          tagLinks: tagRows.map((item) => ({ id: newId(), tagId: item.tagId })),
          attachmentLinks: attachmentRows.map((item) => ({ id: newId(), attachmentId: item.id })),
          ...emptyAudit(now),
        };
      }
      if (cancelled) return;
      const blobs = await db.attachmentBlobs.where('draftId').equals(draft.id).toArray();
      const attachmentUrls = new Map<string, string>();
      blobs.forEach((item) => {
        const url = URL.createObjectURL(item.blob);
        objectUrls.current.push(url);
        attachmentUrls.set(item.id, url);
      });
      if (entry && navigator.onLine) {
        try {
          const detail = await apiRequest<{ attachments: DetailAttachment[] }>(`/entries/${entry.id}`);
          detail.attachments.forEach((attachment) => {
            if (attachment.url) attachmentUrls.set(attachment.id, attachment.url);
            void db.attachments.update(attachment.id, {
              url: attachment.url,
              mimeType: attachment.mimeType,
              originalFilename: attachment.originalFilename,
              byteSize: attachment.byteSize === null ? null : String(attachment.byteSize),
              width: attachment.width,
              height: attachment.height,
              sortOrder: attachment.sortOrder,
              version: attachment.version,
              updatedAt: attachment.updatedAt,
            });
          });
        } catch {
          // The local entry remains editable when the detail or signed URLs are unavailable.
        }
      }
      if (cancelled) return;
      activeDraft.current = draft;
      setCategoryId(draft.categoryId ?? '');
      setSelectedTags((draft.tagLinks ?? []).map((item) => item.tagId));
      setJournalDate(draft.journalDate);
      setJournalTime(draft.journalTime.slice(0, 5));
      markdownRef.current = draft.bodyMarkdown;
      setEditorValue(draft.bodyMarkdown);
      setAttachmentUrls(attachmentUrls);
      setCount(wordCount(draft.bodyMarkdown));
      setReady(true);
    }
    void load();
    return () => {
      cancelled = true;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      objectUrls.current.forEach(URL.revokeObjectURL);
      objectUrls.current = [];
    };
  }, [id, mode, navigate]);

  const persistDraft = useCallback(async () => {
    let previous = activeDraft.current;
    if (!previous) return null;
    const stored = await db.drafts.get(previous.id);
    if (stored && BigInt(stored.version) > BigInt(previous.version)) {
      previous = { ...previous, version: stored.version, createdAt: stored.createdAt, syncError: undefined };
    }
    const bodyMarkdown = editorRef.current?.getMarkdown() ?? markdownRef.current;
    markdownRef.current = bodyMarkdown;
    const attachmentTokens = parseAttachmentMarkdown(bodyMarkdown);
    if (!visibleText(bodyMarkdown) && attachmentTokens.length === 0) {
      setSaveState('空白内容不会保存');
      return null;
    }
    const now = new Date().toISOString();
    const existingTagLinks = new Map((previous.tagLinks ?? []).map((item) => [item.tagId, item.id]));
    const tagLinks = selectedTags.map((tagId) => ({ id: existingTagLinks.get(tagId) ?? newId(), tagId }));
    const attachmentIds = attachmentTokens.map((token) => token.id);
    const existingAttachmentLinks = new Map(
      (previous.attachmentLinks ?? []).map((item) => [item.attachmentId, item.id]),
    );
    const attachmentLinks = attachmentIds.map((attachmentId) => ({
      id: existingAttachmentLinks.get(attachmentId) ?? newId(),
      attachmentId,
    }));
    const next: Draft = {
      ...previous,
      categoryId: categoryId || null,
      bodyMarkdown,
      journalDate,
      journalTime: `${journalTime}:00.000`,
      tagLinks,
      attachmentLinks,
      updatedAt: now,
      lastAutosavedAt: now,
    };
    activeDraft.current = next;
    await db.transaction('rw', [db.drafts, db.draftTags, db.draftAttachmentRefs], async () => {
      await db.drafts.put(next);
      const oldTags = await db.draftTags.where('draftId').equals(next.id).toArray();
      await db.draftTags.bulkPut([
        ...oldTags.map((item) => ({ ...item, deletedAt: selectedTags.includes(item.tagId) ? null : now, updatedAt: now })),
        ...tagLinks
          .filter((item) => !oldTags.some((old) => old.tagId === item.tagId))
          .map((item) => ({ id: item.id, draftId: next.id, tagId: item.tagId, ...emptyAudit(now) })),
      ]);
      const refs = await db.draftAttachmentRefs.where('draftId').equals(next.id).toArray();
      await db.draftAttachmentRefs.bulkPut(
        attachmentLinks.map((item, sortOrder) => ({
          id: item.id,
          draftId: next.id,
          attachmentId: item.attachmentId,
          sortOrder,
          ...(refs.find((ref) => ref.attachmentId === item.attachmentId) ?? emptyAudit(now)),
          updatedAt: now,
          deletedAt: null,
        })),
      );
    });
    await queueOperation({
      entityType: 'draft',
      entityId: next.id,
      operation: 'upsert',
      baseVersion: next.version,
      payload: {
        expectedVersion: next.version,
        kind: next.kind,
        baseEntryId: next.baseEntryId,
        baseVersion: next.baseVersion,
        bodyMarkdown: next.bodyMarkdown,
        journalDate: next.journalDate,
        journalTime: next.journalTime,
        timezoneId: next.timezoneId,
        categoryId: next.categoryId,
        tagLinks,
        attachmentLinks,
        conflictReason: next.conflictReason,
      },
    });
    setCount(wordCount(bodyMarkdown));
    setSaveState('已保存到本地，等待同步');
    return next;
  }, [categoryId, journalDate, journalTime, selectedTags]);

  const scheduleSave = useCallback((nextMarkdown?: string) => {
    const markdown = nextMarkdown ?? editorRef.current?.getMarkdown() ?? markdownRef.current;
    markdownRef.current = markdown;
    setCount(wordCount(markdown));
    setSaveState('正在自动保存…');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persistDraft().then(() => navigator.onLine && void syncNow());
    }, 700);
  }, [persistDraft]);

  useEffect(() => {
    if (!ready) return;
    if (!initializedFields.current) {
      initializedFields.current = true;
      return;
    }
    scheduleSave();
    // Category, tag, and diary time changes use the same autosave path.
  }, [ready, categoryId, selectedTags, journalDate, journalTime]); // eslint-disable-line react-hooks/exhaustive-deps

  async function insertImage(file: File) {
    const draft = activeDraft.current;
    const editor = editorRef.current;
    if (!draft || !editor) return;
    if (!ALLOWED_IMAGES.includes(file.type)) {
      setMessage('仅支持 JPEG、PNG、WebP 或 HEIC 图片');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setMessage('单张图片不能超过 20 MB');
      return;
    }
    const attachmentId = newId();
    const now = new Date().toISOString();
    await db.attachmentBlobs.put({
      id: attachmentId,
      draftId: draft.id,
      blob: file,
      mimeType: file.type,
      originalFilename: file.name || null,
      byteSize: file.size,
      status: 'pending',
      createdAt: now,
    });
    await db.attachments.put({
      id: attachmentId,
      entryId: null,
      draftId: draft.id,
      mediaType: 'image',
      mimeType: file.type,
      originalFilename: file.name || null,
      sha256: null,
      byteSize: String(file.size),
      width: null,
      height: null,
      sortOrder: parseAttachmentMarkdown(markdownRef.current).length,
      remoteState: 'pending',
      ...emptyAudit(now),
    });
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    editor.insertAttachment({ id: attachmentId, src: url, alt: '日记图片' });
    setMessage('图片已插入正文');
  }

  async function finish() {
    const markdown = editorRef.current?.getMarkdown() ?? markdownRef.current;
    const hasImage = parseAttachmentMarkdown(markdown).length > 0;
    if (!visibleText(markdown) && !hasImage) {
      setMessage('空白日记不会被添加');
      return;
    }
    const draft = await persistDraft();
    if (!draft) return;
    const entryId = draft.baseEntryId ?? newId();
    const now = new Date().toISOString();
    const entryTagLinks = (draft.tagLinks ?? []).map((item) => ({ id: newId(), tagId: item.tagId }));
    const pendingDraftOperations = (await db.outbox.where('entityId').equals(draft.id).toArray())
      .filter((item) => item.entityType === 'draft' && item.operation === 'upsert')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const latestDraftBase = pendingDraftOperations.at(-1)?.baseVersion ?? draft.version;
    const expectedDraftVersion = (BigInt(latestDraftBase) + 1n).toString();
    await queueOperation({
      entityType: 'entry',
      entityId: entryId,
      operation: 'upsert',
      baseVersion: draft.baseVersion ?? '0',
      payload: {
        mode: 'publish',
        draftId: draft.id,
        expectedDraftVersion,
        ...(draft.baseVersion ? { expectedEntryVersion: draft.baseVersion } : {}),
        tagLinks: entryTagLinks,
      },
    });
    const existing = draft.baseEntryId ? await db.entries.get(draft.baseEntryId) : undefined;
    await db.entries.put({
      id: entryId,
      categoryId: draft.categoryId,
      bodyMarkdown: draft.bodyMarkdown,
      journalDate: draft.journalDate,
      journalTime: draft.journalTime,
      timezoneId: draft.timezoneId,
      publishedAt: existing?.publishedAt ?? now,
      version: existing?.version ?? '0',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
      optimistic: true,
      attachmentCount: draft.attachmentLinks?.length ?? 0,
    });
    await db.entryTags.bulkPut(
      entryTagLinks.map((item) => ({ id: item.id, entryId, tagId: item.tagId, ...emptyAudit(now) })),
    );
    navigate('/');
    if (navigator.onLine) void syncNow();
  }

  const dateLabel = formatDiaryDate(journalDate, `${journalTime}:00.000`).label;

  return (
    <div className="editor-page">
      <header className="editor-bar">
        <button className="back-button" onClick={() => void persistDraft().finally(() => navigate('/'))}>← <span>返回</span></button>
        <div className="date-fields" title={dateLabel}>
          <input type="date" value={journalDate} onChange={(event) => setJournalDate(event.target.value)} aria-label="日记日期" />
          <input type="time" value={journalTime} onChange={(event) => setJournalTime(event.target.value)} aria-label="日记时间" />
        </div>
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} aria-label="分类">
          <option value="">未分类</option>
          {categories?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <button className="done-button" onClick={() => void finish()} aria-label="完成">✓</button>
      </header>
      <main className="editor-shell">
        {!ready && <div className="loading-state">正在打开本地草稿…</div>}
        {ready && (
          <DiaryEditor
            ref={editorRef}
            value={editorValue}
            attachmentUrls={attachmentUrls}
            onChange={(markdown) => {
              markdownRef.current = markdown;
              scheduleSave(markdown);
            }}
            onPasteImage={(file) => void insertImage(file)}
          />
        )}
        <footer className="writing-footer">
          <b>{count} 字</b><i /><span>{saveState}</span><i />
          <button onClick={() => setTagPicker((value) => !value)}>
            {selectedTags.length ? tags?.filter((tag) => selectedTags.includes(tag.id)).map((tag) => `#${tag.name}`).join('  ') : '＋ 添加标签'}
          </button>
          <small>可直接 Ctrl/Cmd + V 粘贴图片</small>
          <div className="editor-tools">
            <label className="tool-button image-insert-button" title="插入图片">
              <ImagePlus aria-hidden="true" />
              <span>插入图片</span>
              <input
                type="file"
                accept={ALLOWED_IMAGES.join(',')}
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void insertImage(file);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
        </footer>
        {tagPicker && (
          <div className="tag-picker">
            <b>标签</b>
            {tags?.length ? tags.map((tag) => (
              <label key={tag.id}>
                <input
                  type="checkbox"
                  checked={selectedTags.includes(tag.id)}
                  onChange={() => setSelectedTags((value) => value.includes(tag.id) ? value.filter((id) => id !== tag.id) : [...value, tag.id])}
                />
                #{tag.name}
              </label>
            )) : <span>还没有标签，可稍后在设置中创建</span>}
          </div>
        )}
      </main>
      {message && <button className="toast" onClick={() => setMessage('')}>{message}</button>}
    </div>
  );
}
