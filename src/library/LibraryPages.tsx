import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../data/db';
import { queueOperation } from '../data/sync';
import type { Draft, Entry } from '../domain/types';
import { firstHeading, visibleText, wordCount } from '../lib/markdown';
import { formatDiaryDate } from '../lib/time';

function LibraryHeader({ title }: { title: string }) {
  return <header className="library-header"><Link to="/">← 返回</Link><h1>{title}</h1><span /></header>;
}

function TextList({ entries }: { entries: Entry[] }) {
  if (!entries.length) return <div className="empty-state"><b>这里还是空的</b><span>内容会在符合条件时出现在这里</span></div>;
  return (
    <div className="text-list">
      {entries.map((entry) => {
        const date = formatDiaryDate(entry.journalDate, entry.journalTime);
        return <Link key={entry.id} to={`/entry/${entry.id}`}><b>{firstHeading(entry.bodyMarkdown) || '无标题日记'}</b><p>{visibleText(entry.bodyMarkdown).slice(0, 120)}</p><span>{date.label} · {wordCount(entry.bodyMarkdown)} 字</span></Link>;
      })}
    </div>
  );
}

export function DraftsPage() {
  const drafts = useLiveQuery(() => db.drafts.filter((item) => !item.deletedAt && !item.publishedEntryId).reverse().sortBy('lastAutosavedAt'), [], []);
  return <div className="library-page"><LibraryHeader title="草稿" /><main>{drafts.length ? <div className="text-list">{drafts.map((draft: Draft) => <Link key={draft.id} to={draft.baseEntryId ? `/entry/${draft.baseEntryId}` : `/new/${draft.id}`}><b>{firstHeading(draft.bodyMarkdown) || '未命名草稿'}</b><p>{visibleText(draft.bodyMarkdown).slice(0, 120)}</p><span>{draft.kind === 'conflict' ? '同步冲突草稿' : '自动保存'} · {wordCount(draft.bodyMarkdown)} 字</span></Link>)}</div> : <div className="empty-state"><b>没有未完成的草稿</b><span>未点击完成的内容会自动保存在这里</span></div>}</main></div>;
}

export function TrashPage() {
  const entries = useLiveQuery(() => db.entries.filter((item) => Boolean(item.deletedAt)).reverse().sortBy('deletedAt'), [], []);
  async function restore(entry: Entry) {
    await db.entries.update(entry.id, { deletedAt: null });
    await queueOperation({ entityType: 'entry', entityId: entry.id, operation: 'restore', baseVersion: entry.version, payload: {} });
  }
  return <div className="library-page"><LibraryHeader title="回收站" /><main>{entries.length ? <div className="text-list">{entries.map((entry) => <div className="trash-row" key={entry.id}><div><b>{firstHeading(entry.bodyMarkdown) || '无标题日记'}</b><p>{visibleText(entry.bodyMarkdown).slice(0, 100)}</p><span>删除后保留 30 天</span></div><button onClick={() => void restore(entry)}>恢复</button></div>)}</div> : <div className="empty-state"><b>回收站是空的</b><span>删除的日记会在这里保留 30 天</span></div>}</main></div>;
}

export function MemoriesPage() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const entries = useLiveQuery(() => db.entries.filter((item) => !item.deletedAt && item.journalDate.slice(5) === `${month}-${day}` && !item.journalDate.startsWith(String(now.getFullYear()))).reverse().sortBy('journalDate'), [month, day], []);
  return <div className="library-page"><LibraryHeader title="往年今日" /><main><TextList entries={entries} /></main></div>;
}

export function CalendarPage() {
  const navigate = useNavigate();
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const entries = useLiveQuery(() => db.entries.filter((item) => !item.deletedAt && item.journalDate.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).toArray(), [year, month], []);
  const counts = new Map<number, Entry[]>();
  entries.forEach((entry) => {
    const day = Number(entry.journalDate.slice(8));
    counts.set(day, [...(counts.get(day) ?? []), entry]);
  });
  const start = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  return <div className="library-page"><LibraryHeader title={`${year} 年 ${month + 1} 月`} /><main className="calendar"><div className="weekdays">{['日','一','二','三','四','五','六'].map((value) => <span key={value}>{value}</span>)}</div><div className="calendar-grid">{Array.from({ length: start }, (_, index) => <i key={`blank-${index}`} />)}{Array.from({ length: days }, (_, index) => index + 1).map((day) => { const items = counts.get(day) ?? []; return <button key={day} className={items.length ? 'has-entry' : ''} onClick={() => items[0] && navigate(`/entry/${items[0].id}`)}><b>{day}</b>{items.length ? <span>{items.length} 篇</span> : null}</button>; })}</div></main></div>;
}
