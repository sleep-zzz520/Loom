import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock3 } from 'lucide-react';

type DateFieldProps = {
  mode: 'date' | 'datetime';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
};

type TimeFieldProps = {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function parseDate(value: string, mode: DateFieldProps['mode']): Date | null {
  if (!value) return null;
  const date = new Date(mode === 'date' ? `${value}T12:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateValue(date: Date, mode: DateFieldProps['mode'], hour = date.getHours(), minute = date.getMinutes()) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return mode === 'date' ? day : `${day}T${pad(hour)}:${pad(minute)}`;
}

function dateLabel(date: Date, mode: DateFieldProps['mode']) {
  const base = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  }).format(date);
  if (mode === 'date') return base;
  return `${base} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function validTime(value: string, max: number) {
  return /^\d{1,2}$/.test(value) && Number(value) >= 0 && Number(value) <= max;
}

export function DateField({ mode, value, onChange, placeholder = '选择日期', ariaLabel }: DateFieldProps) {
  const current = useMemo(() => parseDate(value, mode), [value, mode]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => current || new Date());
  const [hour, setHour] = useState(() => pad(current?.getHours() ?? 9));
  const [minute, setMinute] = useState(() => pad(current?.getMinutes() ?? 0));

  useEffect(() => {
    if (open) return;
    const next = parseDate(value, mode) || new Date();
    setCursor(next);
    setHour(pad(next.getHours()));
    setMinute(pad(next.getMinutes()));
  }, [value, mode, open]);

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      return { date, inMonth: date.getMonth() === cursor.getMonth() };
    });
  }, [cursor]);

  function toggle() {
    if (!open) {
      const next = current || new Date();
      setCursor(next);
      setHour(pad(next.getHours()));
      setMinute(pad(next.getMinutes()));
    }
    setOpen((shown) => !shown);
  }

  function chooseDate(date: Date) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), current?.getHours() ?? 9, current?.getMinutes() ?? 0);
    const nextHour = validTime(hour, 23) ? Number(hour) : next.getHours();
    const nextMinute = validTime(minute, 59) ? Number(minute) : next.getMinutes();
    onChange(dateValue(next, mode, nextHour, nextMinute));
    if (mode === 'date') setOpen(false);
  }

  function commitTime() {
    if (!validTime(hour, 23) || !validTime(minute, 59)) {
      const next = current || new Date();
      setHour(pad(next.getHours()));
      setMinute(pad(next.getMinutes()));
      return;
    }
    const next = current || new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    onChange(dateValue(next, mode, Number(hour), Number(minute)));
  }

  function goToday() {
    const now = new Date();
    setCursor(now);
    onChange(dateValue(now, mode));
    if (mode === 'date') setOpen(false);
  }

  return (
    <div className="date-field">
      <button type="button" className="date-field-trigger" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <CalendarDays size={15} />
        <span>{current ? dateLabel(current, mode) : placeholder}</span>
      </button>
      {open && (
        <div className="date-field-popover" role="dialog" aria-label={ariaLabel}>
          <div className="date-field-nav">
            <button type="button" className="icon-btn" aria-label="上一年" onClick={() => setCursor((date) => new Date(date.getFullYear() - 1, date.getMonth(), 1))}><ChevronsLeft size={15} /></button>
            <button type="button" className="icon-btn" aria-label="上一月" onClick={() => setCursor((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
            <strong>{cursor.getFullYear()}年 {cursor.getMonth() + 1}月</strong>
            <button type="button" className="icon-btn" aria-label="下一月" onClick={() => setCursor((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
            <button type="button" className="icon-btn" aria-label="下一年" onClick={() => setCursor((date) => new Date(date.getFullYear() + 1, date.getMonth(), 1))}><ChevronsRight size={15} /></button>
          </div>
          <div className="date-field-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="date-field-grid">
            {cells.map(({ date, inMonth }) => {
              const selected = current && date.toDateString() === current.toDateString();
              const today = date.toDateString() === new Date().toDateString();
              return <button key={date.toISOString()} type="button" className={`date-field-day${inMonth ? '' : ' muted'}${selected ? ' selected' : ''}${today ? ' today' : ''}`} onClick={() => chooseDate(date)}>{date.getDate()}</button>;
            })}
          </div>
          {mode === 'datetime' && (
            <div className="date-field-time">
              <Clock3 size={14} />
              <input aria-label="小时" inputMode="numeric" maxLength={2} value={hour} onChange={(event) => setHour(event.target.value.replace(/\D/g, ''))} onBlur={commitTime} />
              <span>:</span>
              <input aria-label="分钟" inputMode="numeric" maxLength={2} value={minute} onChange={(event) => setMinute(event.target.value.replace(/\D/g, ''))} onBlur={commitTime} />
            </div>
          )}
          <div className="date-field-footer"><button type="button" className="text-btn" onClick={goToday}>今天</button><button type="button" className="text-btn" onClick={() => setOpen(false)}>完成</button></div>
        </div>
      )}
    </div>
  );
}

export function TimeField({ value, onChange, ariaLabel }: TimeFieldProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    const [hour, minute] = draft.split(':');
    if (validTime(hour || '', 23) && validTime(minute || '', 59)) {
      onChange(`${pad(Number(hour))}:${pad(Number(minute))}`);
      return;
    }
    setDraft(value);
  }

  return <div className="time-field"><Clock3 size={15} /><input type="text" inputMode="numeric" maxLength={5} aria-label={ariaLabel} value={draft} placeholder="23:00" onChange={(event) => setDraft(event.target.value.replace(/[^\d:]/g, ''))} onBlur={commit} /></div>;
}
