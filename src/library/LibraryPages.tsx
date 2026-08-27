import { useLiveQuery } from 'dexie-react-hooks';
import { getLocalTimeZone, today } from '@internationalized/date';
import { ArrowLeft, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from 'react-aria-components/Button';
import {
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
} from 'react-aria-components/Calendar';
import { Heading } from 'react-aria-components/Heading';
import { I18nProvider } from 'react-aria-components/I18nProvider';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../data/db';
import { queueOperation } from '../data/sync';
import type { Draft, Entry } from '../domain/types';
import { firstHeading, visibleText, wordCount } from '../lib/markdown';
import { formatDiaryDate } from '../lib/time';
import { AppIcon } from '../ui/icons';

function LibraryHeader({ title }: { title: string }) {
  return <header className="library-header"><Link to="/"><AppIcon icon={ArrowLeft} name="back" />返回</Link><h1>{title}</h1><span /></header>;
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
  return <div className="library-page"><LibraryHeader title="回收站" /><main>{entries.length ? <div className="text-list">{entries.map((entry) => <div className="trash-row" key={entry.id}><div><b>{firstHeading(entry.bodyMarkdown) || '无标题日记'}</b><p>{visibleText(entry.bodyMarkdown).slice(0, 100)}</p><span>删除后保留 30 天</span></div><button onClick={() => void restore(entry)}><AppIcon icon={RotateCcw} name="restore" size={16} />恢复</button></div>)}</div> : <div className="empty-state"><b>回收站是空的</b><span>删除的日记会在这里保留 30 天</span></div>}</main></div>;
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
  const [focusedDate, setFocusedDate] = useState(() => today(getLocalTimeZone()));
  const monthPrefix = `${focusedDate.year}-${String(focusedDate.month).padStart(2, '0')}`;
  const entries = useLiveQuery(
    () => db.entries.filter((item) => !item.deletedAt && item.journalDate.startsWith(monthPrefix)).toArray(),
    [monthPrefix],
    [],
  );
  const entriesByDate = useMemo(() => {
    const next = new Map<string, Entry[]>();
    entries.forEach((entry) => next.set(entry.journalDate, [...(next.get(entry.journalDate) ?? []), entry]));
    return next;
  }, [entries]);

  return (
    <div className="library-page calendar-page">
      <LibraryHeader title="日历" />
      <main className="calendar-shell">
        <I18nProvider locale="zh-CN">
          <Calendar
            aria-label="日记日历"
            className="journal-calendar"
            focusedValue={focusedDate}
            onFocusChange={setFocusedDate}
            onChange={(date) => {
              const entry = entriesByDate.get(date.toString())?.[0];
              if (entry) navigate(`/entry/${entry.id}`);
            }}
          >
            <header className="journal-calendar-header">
              <div>
                <span>按日期回看</span>
                <Heading />
              </div>
              <nav aria-label="切换月份">
                <Button slot="previous" aria-label="上个月"><AppIcon icon={ChevronLeft} name="previous-month" /></Button>
                <Button slot="next" aria-label="下个月"><AppIcon icon={ChevronRight} name="next-month" /></Button>
              </nav>
            </header>
            <CalendarGrid>
              <CalendarGridHeader>
                {(day) => <CalendarHeaderCell>{day}</CalendarHeaderCell>}
              </CalendarGridHeader>
              <CalendarGridBody>
                {(date) => {
                  const items = entriesByDate.get(date.toString()) ?? [];
                  return (
                    <CalendarCell date={date} className={`journal-calendar-cell ${items.length ? 'has-entry' : ''}`}>
                      {({ formattedDate }) => (
                        <div className="journal-calendar-cell-content">
                          <span className="calendar-day-number">{formattedDate}</span>
                          {items.length ? <span className="calendar-entry-count">{items.length} 篇</span> : null}
                        </div>
                      )}
                    </CalendarCell>
                  );
                }}
              </CalendarGridBody>
            </CalendarGrid>
          </Calendar>
        </I18nProvider>
      </main>
    </div>
  );
}
