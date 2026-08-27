import { parseDate } from '@internationalized/date';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, Minus, Plus } from 'lucide-react';
import { useState } from 'react';
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
  DialogTrigger,
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
import { Input } from 'react-aria-components/Input';
import { Modal, ModalOverlay } from 'react-aria-components/Modal';
import { NumberField } from 'react-aria-components/NumberField';
import {
  Select,
  SelectValue,
} from 'react-aria-components/Select';
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

function timeParts(value: string) {
  const [hour = '0', minute = '0'] = value.split(':');
  return { hour: Number(hour), minute: Number(minute) };
}

function formatTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

type TimeDialogProps = {
  value: string;
  onChange(value: string): void;
};

function TimeDialog({ value, onChange }: TimeDialogProps) {
  const initial = timeParts(value);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);

  function resetDraft() {
    const next = timeParts(value);
    setHour(next.hour);
    setMinute(next.minute);
  }

  function useCurrentTime() {
    const now = new Date();
    setHour(now.getHours());
    setMinute(now.getMinutes());
  }

  return (
    <DialogTrigger onOpenChange={(open) => { if (open) resetDraft(); }}>
      <Button className="field-trigger time-trigger" aria-label={`设置时间，当前 ${value}`}>
        <AppIcon icon={Clock3} name="time" size={16} />
        <span>{value}</span>
      </Button>
      <ModalOverlay className="time-modal-overlay" isDismissable>
        <Modal className="time-modal">
          <Dialog aria-label="设置日记时间" className="time-dialog">
            {({ close }) => (
              <>
                <header>
                  <span>日记时间</span>
                  <strong>{formatTime(hour, minute)}</strong>
                  <p>分别输入小时与分钟，确认后才会修改。</p>
                </header>
                <div className="time-stepper-row">
                  <NumberField
                    aria-label="小时"
                    value={hour}
                    minValue={0}
                    maxValue={23}
                    formatOptions={{ minimumIntegerDigits: 2, useGrouping: false }}
                    onChange={(next) => { if (Number.isFinite(next)) setHour(next); }}
                  >
                    <span className="time-stepper-label">小时</span>
                    <Group className="time-stepper">
                      <Button slot="decrement" aria-label="小时减一"><AppIcon icon={Minus} name="decrease-hour" size={16} /></Button>
                      <Input />
                      <Button slot="increment" aria-label="小时加一"><AppIcon icon={Plus} name="increase-hour" size={16} /></Button>
                    </Group>
                  </NumberField>
                  <span className="time-colon" aria-hidden="true">:</span>
                  <NumberField
                    aria-label="分钟"
                    value={minute}
                    minValue={0}
                    maxValue={59}
                    formatOptions={{ minimumIntegerDigits: 2, useGrouping: false }}
                    onChange={(next) => { if (Number.isFinite(next)) setMinute(next); }}
                  >
                    <span className="time-stepper-label">分钟</span>
                    <Group className="time-stepper">
                      <Button slot="decrement" aria-label="分钟减一"><AppIcon icon={Minus} name="decrease-minute" size={16} /></Button>
                      <Input />
                      <Button slot="increment" aria-label="分钟加一"><AppIcon icon={Plus} name="increase-minute" size={16} /></Button>
                    </Group>
                  </NumberField>
                </div>
                <footer>
                  <Button className="time-now-button" onPress={useCurrentTime}>现在</Button>
                  <span />
                  <Button className="time-cancel-button" onPress={close}>取消</Button>
                  <Button className="time-confirm-button" onPress={() => { onChange(formatTime(hour, minute)); close(); }}>确定</Button>
                </footer>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
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

        <TimeDialog value={journalTime} onChange={onTimeChange} />

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
