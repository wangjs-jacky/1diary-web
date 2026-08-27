import { useLiveQuery } from 'dexie-react-hooks';
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CloudCheck,
  CloudCog,
  CloudOff,
  Ellipsis,
  FilePenLine,
  History,
  LogOut,
  MoonStar,
  PencilLine,
  Plus,
  Search,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiRequest } from '../data/api';
import { db } from '../data/db';
import { queueOperation } from '../data/sync';
import type { Category, Entry, Tag } from '../domain/types';
import { newId } from '../lib/ids';
import { firstHeading, markdownToHtml, visibleText, wordCount } from '../lib/markdown';
import { formatDiaryDate } from '../lib/time';
import { useSync } from '../sync/SyncContext';
import { AppIcon, DiaryMark } from '../ui/icons';

type TimelineData = {
  entries: Entry[];
  categories: Map<string, Category>;
  tagsByEntry: Map<string, Tag[]>;
  drafts: number;
};

function readableSyncError(error: string) {
  const messages: Record<string, string> = {
    TEMPORARY_FAILURE: '上次连接服务器失败',
    NETWORK_ERROR: '上次网络连接失败',
    UPLOAD_FAILED: '上次图片上传失败',
  };
  const message = messages[error];
  return message ? `${message}（${error}）` : error;
}

function useTimelineData() {
  return useLiveQuery<TimelineData>(async () => {
    const [allEntries, categoryRows, tagRows, entryTagRows, attachmentRows, drafts] = await Promise.all([
      db.entries.toArray(),
      db.categories.toArray(),
      db.tags.toArray(),
      db.entryTags.toArray(),
      db.attachments.toArray(),
      db.drafts.toArray(),
    ]);
    const categories = new Map(categoryRows.filter((item) => !item.deletedAt).map((item) => [item.id, item]));
    const tags = new Map(tagRows.filter((item) => !item.deletedAt).map((item) => [item.id, item]));
    const tagsByEntry = new Map<string, Tag[]>();
    entryTagRows.filter((item) => !item.deletedAt).forEach((link) => {
      const tag = tags.get(link.tagId);
      if (!tag) return;
      tagsByEntry.set(link.entryId, [...(tagsByEntry.get(link.entryId) ?? []), tag]);
    });
    const attachmentCount = new Map<string, number>();
    attachmentRows.filter((item) => !item.deletedAt && item.entryId).forEach((item) => {
      attachmentCount.set(item.entryId!, (attachmentCount.get(item.entryId!) ?? 0) + 1);
    });
    return {
      entries: allEntries
        .filter((item) => !item.deletedAt)
        .map((item) => ({ ...item, attachmentCount: item.attachmentCount ?? attachmentCount.get(item.id) ?? 0 }))
        .sort((a, b) =>
          `${b.journalDate} ${b.journalTime} ${b.createdAt} ${b.id}`.localeCompare(
            `${a.journalDate} ${a.journalTime} ${a.createdAt} ${a.id}`,
          ),
        ),
      categories,
      tagsByEntry,
      drafts: drafts.filter((item) => !item.deletedAt && !item.publishedEntryId).length,
    };
  }, []);
}

function SyncBadge() {
  const { status, detail, sync } = useSync();
  const [open, setOpen] = useState(false);
  const pending = useLiveQuery(async () => {
    const [operations, attachments] = await Promise.all([
      db.outbox.orderBy('createdAt').toArray(),
      db.attachmentBlobs.where('status').anyOf('pending', 'uploading', 'failed').toArray(),
    ]);
    return { operations, attachments };
  }, []);
  const labels = {
    idle: '已同步',
    syncing: '同步中…',
    partial: '部分待同步',
    offline: '离线写作',
    error: '同步失败',
  };
  const entityLabels = {
    category: '分类',
    tag: '标签',
    entry: '日记',
    draft: '草稿',
    entry_tag: '日记标签',
    draft_tag: '草稿标签',
    attachment: '图片信息',
    draft_attachment_ref: '图片关联',
  };
  const operationLabels = {
    upsert: '保存',
    soft_delete: '删除',
    restore: '恢复',
    purge: '彻底删除',
  };
  const operationCount = pending?.operations.length ?? 0;
  const attachmentCount = pending?.attachments.length ?? 0;
  const statusIcons = {
    idle: { icon: CloudCheck, name: 'cloud-check' },
    syncing: { icon: CloudCog, name: 'cloud-sync' },
    partial: { icon: CloudCog, name: 'cloud-pending' },
    offline: { icon: CloudOff, name: 'cloud-off' },
    error: { icon: CloudOff, name: 'cloud-error' },
  };
  const statusIcon = statusIcons[status];
  return (
    <div className="sync-control">
      <button
        className={`sync-badge ${status}`}
        onClick={() => setOpen((value) => !value)}
        title={detail ?? '查看同步状态'}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <AppIcon icon={statusIcon.icon} name={statusIcon.name} size={16} />
        <span>{labels[status]}</span>
      </button>
      {open && (
        <section className="sync-details" role="dialog" aria-label="同步详情">
          <header>
            <div><b>同步详情</b><span>{detail ?? '本地内容已与服务器同步'}</span></div>
            <button onClick={() => setOpen(false)} aria-label="关闭同步详情"><AppIcon icon={X} name="close" size={16} /></button>
          </header>
          {operationCount + attachmentCount === 0 ? (
            <p className="sync-empty">当前没有等待同步的内容</p>
          ) : (
            <ul>
              {pending?.operations.map((item) => (
                <li key={item.operationId}>
                  <b>{entityLabels[item.entityType]} · {operationLabels[item.operation]}</b>
                  <span>{item.lastError ? readableSyncError(item.lastError) : (item.attempts ? `已经重试 ${item.attempts} 次` : '等待发送')}</span>
                </li>
              ))}
              {pending?.attachments.map((item) => (
                <li key={item.id}>
                  <b>图片 · {item.originalFilename ?? '未命名图片'}</b>
                  <span>{item.error ?? (item.status === 'uploading' ? '上次上传被中断，将重新尝试' : '等待上传')}</span>
                </li>
              ))}
            </ul>
          )}
          <footer>
            <small>{operationCount} 条内容 · {attachmentCount} 张图片</small>
            <button onClick={() => void sync()}><AppIcon icon={CloudCog} name="retry-sync" size={15} />立即重试</button>
          </footer>
        </section>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  category,
  tags,
  onDelete,
}: {
  entry: Entry;
  category?: Category;
  tags: Tag[];
  onDelete(): void;
}) {
  const navigate = useNavigate();
  const date = formatDiaryDate(entry.journalDate, entry.journalTime);
  const [expanded, setExpanded] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const bodyText = visibleText(entry.bodyMarkdown);
  const long = bodyText.length > 460;
  const html = useMemo(
    () => markdownToHtml(entry.bodyMarkdown, attachmentUrls),
    [entry.bodyMarkdown, attachmentUrls],
  );
  useEffect(() => {
    const ids = [...entry.bodyMarkdown.matchAll(/attachment:\/\/([0-9a-z-]+)/g)].map((match) => match[1]!);
    if (!ids.length) return;
    let active = true;
    const localUrls: string[] = [];
    void (async () => {
      const next = new Map<string, string>();
      const blobs = await db.attachmentBlobs.bulkGet(ids);
      blobs.forEach((item) => {
        if (!item) return;
        const url = URL.createObjectURL(item.blob);
        localUrls.push(url);
        next.set(item.id, url);
      });
      const cached = await db.attachments.bulkGet(ids);
      cached.forEach((item) => { if (item?.url) next.set(item.id, item.url); });
      if (navigator.onLine && next.size < ids.length) {
        try {
          const detail = await apiRequest<{ attachments: Array<{ id: string; url: string | null }> }>(`/entries/${entry.id}`);
          detail.attachments.forEach((item) => { if (item.url) next.set(item.id, item.url); });
        } catch {
          // Text remains readable while image URLs are temporarily unavailable.
        }
      }
      if (active) setAttachmentUrls(next);
    })();
    return () => {
      active = false;
      localUrls.forEach(URL.revokeObjectURL);
    };
  }, [entry.bodyMarkdown, entry.id]);
  return (
    <article
      className={`diary-card ${long && !expanded ? 'is-clamped' : ''}`}
      onClick={() => navigate(`/entry/${entry.id}`)}
    >
      <header className="entry-head">
        <b>{String(date.day).padStart(2, '0')}</b>
        <span>{date.month} 月 · {date.weekday}<br />{entry.journalTime.slice(0, 5)}</span>
        {entry.syncError ? <em title={entry.syncError}>同步需要处理</em> : entry.optimistic && <em>等待同步</em>}
      </header>
      <div className="rendered-markdown" dangerouslySetInnerHTML={{ __html: html }} />
      {long && (
        <button
          className="expand-button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          <AppIcon icon={expanded ? ChevronUp : ChevronDown} name={expanded ? 'collapse' : 'expand'} size={15} />
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
      <footer className="entry-footer">
        <span>{wordCount(entry.bodyMarkdown)} 字</span>
        {category && <span className="category"><i />{category.name}</span>}
        <span>{tags.map((tag) => `#${tag.name}`).join('  ')}</span>
        {entry.attachmentCount ? <span>{entry.attachmentCount} 张图片</span> : null}
        <div className="entry-actions">
          <button title="编辑日记" aria-label="编辑日记" onClick={(event) => { event.stopPropagation(); navigate(`/entry/${entry.id}`); }}><AppIcon icon={PencilLine} name="edit" /></button>
          <button title="删除日记" aria-label="删除日记" onClick={(event) => { event.stopPropagation(); onDelete(); }}><AppIcon icon={Trash2} name="delete" /></button>
        </div>
      </footer>
    </article>
  );
}

export function TimelinePage() {
  const data = useTimelineData();
  const auth = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme !== 'light');

  const entries = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return data.entries;
    return data.entries.filter((entry) => {
      const category = entry.categoryId ? data.categories.get(entry.categoryId)?.name : '';
      const tags = (data.tagsByEntry.get(entry.id) ?? []).map((tag) => tag.name).join(' ');
      return `${entry.bodyMarkdown} ${category} ${tags}`.toLocaleLowerCase().includes(normalized);
    });
  }, [data, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Entry[]>();
    entries.forEach((entry) => {
      const key = entry.journalDate.slice(0, 7);
      map.set(key, [...(map.get(key) ?? []), entry]);
    });
    return [...map.entries()];
  }, [entries]);

  async function remove(entry: Entry) {
    if (!window.confirm('移入回收站？日记和附件将在 30 天后彻底删除。')) return;
    await db.entries.update(entry.id, { deletedAt: new Date().toISOString() });
    await queueOperation({ entityType: 'entry', entityId: entry.id, operation: 'soft_delete', baseVersion: entry.version, payload: {} });
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    localStorage.setItem('1diary.theme', next ? 'dark' : 'light');
  }

  return (
    <div className="app-page">
      <header className="app-bar">
        <div><SyncBadge /></div>
        <Link to="/" className="brand" aria-label="一本日记"><DiaryMark /><span>一本日记</span></Link>
        <div className="bar-actions">
          <button className="icon-button" onClick={() => setSearchOpen((value) => !value)} aria-label="搜索"><AppIcon icon={Search} name="search" /></button>
          <button className="icon-button" onClick={toggleTheme} aria-label="切换主题"><AppIcon icon={dark ? Sun : MoonStar} name={dark ? 'sun' : 'moon'} /></button>
          <button className="icon-button" onClick={() => setMenuOpen((value) => !value)} aria-label="更多"><AppIcon icon={Ellipsis} name="more" /></button>
        </div>
        {menuOpen && (
          <nav className="app-menu">
            <Link to="/drafts"><AppIcon icon={FilePenLine} name="drafts" />草稿 <span>{data?.drafts ?? 0}</span></Link>
            <Link to="/calendar"><AppIcon icon={CalendarDays} name="calendar" />日历</Link>
            <Link to="/memories"><AppIcon icon={History} name="memories" />往年今日</Link>
            <Link to="/trash"><AppIcon icon={Trash2} name="trash" />回收站</Link>
            <button onClick={() => void auth.signOut()}><AppIcon icon={LogOut} name="logout" />退出账号</button>
          </nav>
        )}
      </header>
      {searchOpen && (
        <div className="search-panel">
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索正文、分类或标签…" />
          <button onClick={() => { setQuery(''); setSearchOpen(false); }} aria-label="关闭搜索"><AppIcon icon={X} name="close-search" /></button>
        </div>
      )}
      <main className="timeline">
        <div className="timeline-summary"><span>{new Date().getFullYear()} 年</span><small>{query ? `找到 ${entries.length} 篇` : `共 ${data?.entries.length ?? 0} 篇`}</small></div>
        {!data ? (
          <div className="loading-state">正在打开本地日记…</div>
        ) : groups.length === 0 ? (
          <div className="empty-state">
            <b>{query ? '没有找到相关日记' : '还没有写下第一篇日记'}</b>
            <span>{query ? '换个关键词试试' : '离线时也可以开始写作'}</span>
          </div>
        ) : (
          groups.map(([month, monthEntries]) => {
            const monthNumber = Number(month.slice(5));
            return (
              <section key={month} className="month-section">
                <div className="month-heading"><b>{monthNumber} 月</b><span>{monthEntries.length} 篇</span></div>
                {monthEntries.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    category={entry.categoryId ? data.categories.get(entry.categoryId) : undefined}
                    tags={data.tagsByEntry.get(entry.id) ?? []}
                    onDelete={() => void remove(entry)}
                  />
                ))}
              </section>
            );
          })
        )}
      </main>
      <button className="new-entry-button" onClick={() => navigate(`/new/${newId()}`)} aria-label="写新日记"><AppIcon icon={Plus} name="new-entry" size={24} /></button>
    </div>
  );
}
