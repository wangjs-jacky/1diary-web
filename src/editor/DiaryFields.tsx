import { parseDate, parseTime } from '@internationalized/date';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { Button } from 'react-aria-components/Button';
import {
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
} from 'react-aria-components/Calendar';
import {
  DateInput,
  DateSegment,
} from 'react-aria-components/DateField';
import { DatePicker } from 'react-aria-components/DatePicker';
import {
  Dialog,
} from 'react-aria-components/Dialog';
import {
  Group,
} from 'react-aria-components/Group';
import { Heading } from 'react-aria-components/Heading';
import { I18nProvider } from 'react-aria-components/I18nProvider';
import {
  ListBox,
  ListBoxItem,
} from 'react-aria-components/ListBox';
import {
  Popover,
} from 'react-aria-components/Popover';
import {
  Select,
  SelectValue,
} from 'react-aria-components/Select';
import { TimeField } from 'react-aria-components/TimeField';
import type { Category } from '../domain/types';
import { AppIcon } from '../ui/icons';

type DiaryFieldsProps = {
  journalDate: string;
  journalTime: string;
  categoryId: string;
  categories: Category[];
  onDateChange(value: string): void;
  onTimeChange(value: string): void;
  onCategoryChange(value: string): void;
};

function CalendarPopover() {
  return (
    <Popover className="field-popover calendar-popover">
      <Dialog>
        <Calendar>
          <header className="calendar-header">
            <Button slot="previous" aria-label="上个月"><AppIcon icon={ChevronLeft} name="previous-month" size={16} /></Button>
            <Heading />
            <Button slot="next" aria-label="下个月"><AppIcon icon={ChevronRight} name="next-month" size={16} /></Button>
          </header>
          <CalendarGrid>
            <CalendarGridHeader>
              {(day) => <CalendarHeaderCell>{day}</CalendarHeaderCell>}
            </CalendarGridHeader>
            <CalendarGridBody>
              {(date) => <CalendarCell date={date} />}
            </CalendarGridBody>
          </CalendarGrid>
        </Calendar>
      </Dialog>
    </Popover>
  );
}

export function DiaryFields({
  journalDate,
  journalTime,
  categoryId,
  categories,
  onDateChange,
  onTimeChange,
  onCategoryChange,
}: DiaryFieldsProps) {
  return (
    <I18nProvider locale="zh-CN">
      <div className="diary-fields">
        <DatePicker
          aria-label="日记日期"
          value={parseDate(journalDate)}
          onChange={(value) => value && onDateChange(value.toString())}
        >
          <Group className="field-trigger date-trigger">
            <AppIcon icon={CalendarDays} name="calendar" size={16} />
            <DateInput>{(segment) => <DateSegment segment={segment} />}</DateInput>
            <Button aria-label="选择日期"><AppIcon icon={ChevronDown} name="open-calendar" size={14} /></Button>
          </Group>
          <CalendarPopover />
        </DatePicker>

        <TimeField
          aria-label="日记时间"
          value={parseTime(journalTime)}
          onChange={(value) => value && onTimeChange(value.toString().slice(0, 5))}
        >
          <Group className="field-trigger time-trigger">
            <AppIcon icon={Clock3} name="time" size={16} />
            <DateInput>{(segment) => <DateSegment segment={segment} />}</DateInput>
          </Group>
        </TimeField>

        <Select
          aria-label="分类"
          selectedKey={categoryId || 'uncategorized'}
          onSelectionChange={(key) => onCategoryChange(key === 'uncategorized' ? '' : String(key))}
        >
          <Button className="field-trigger category-trigger" aria-label="选择分类">
            <SelectValue />
            <AppIcon icon={ChevronDown} name="open-category" size={14} />
          </Button>
          <Popover className="field-popover select-popover">
            <ListBox>
              <ListBoxItem id="uncategorized" textValue="未分类">未分类</ListBoxItem>
              {categories.map((category) => (
                <ListBoxItem key={category.id} id={category.id} textValue={category.name}>
                  {category.name}
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </Select>
      </div>
    </I18nProvider>
  );
}
