import { useLiveQuery } from 'dexie-react-hooks';
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

type TimelineData = {
  entries: Entry[];
  categories: Map<string, Category>;
  tagsByEntry: Map<string, Tag[]>;
  drafts: number;
};

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
  const { status, sync } = useSync();
  const labels = { idle: '已同步', syncing: '同步中…', offline: '离线写作', error: '同步失败' };
  return (
    <button className={`sync-badge ${status}`} onClick={() => void sync()} title="立即同步">
      <i /> {labels[status]}
    </button>
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
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
      <footer className="entry-footer">
        <span>{wordCount(entry.bodyMarkdown)} 字</span>
        {category && <span className="category"><i />{category.name}</span>}
        <span>{tags.map((tag) => `#${tag.name}`).join('  ')}</span>
        {entry.attachmentCount ? <span>{entry.attachmentCount} 张图片</span> : null}
        <div className="entry-actions">
          <button onClick={(event) => { event.stopPropagation(); navigate(`/entry/${entry.id}`); }}>编辑</button>
          <button onClick={(event) => { event.stopPropagation(); onDelete(); }}>删除</button>
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
        <Link to="/" className="brand">一本日记</Link>
        <div className="bar-actions">
          <button className="icon-button" onClick={() => setSearchOpen((value) => !value)} aria-label="搜索">⌕</button>
          <button className="icon-button" onClick={toggleTheme} aria-label="切换主题">{dark ? '☼' : '☾'}</button>
          <button className="icon-button" onClick={() => setMenuOpen((value) => !value)} aria-label="更多">···</button>
        </div>
        {menuOpen && (
          <nav className="app-menu">
            <Link to="/drafts">草稿 <span>{data?.drafts ?? 0}</span></Link>
            <Link to="/calendar">日历</Link>
            <Link to="/memories">往年今日</Link>
            <Link to="/trash">回收站</Link>
            <button onClick={() => void auth.signOut()}>退出账号</button>
          </nav>
        )}
      </header>
      {searchOpen && (
        <div className="search-panel">
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索正文、分类或标签…" />
          <button onClick={() => { setQuery(''); setSearchOpen(false); }}>×</button>
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
      <button className="new-entry-button" onClick={() => navigate(`/new/${newId()}`)} aria-label="写新日记">＋</button>
    </div>
  );
}
