export type QuickCaptureKind = 'todo' | 'event' | 'note';

export type QuickCaptureDraft = {
  kind: QuickCaptureKind;
  title: string;
  content: string;
  start: string | null;
  due: string | null;
  error: string | null;
};

const EVENT_HELP = '日程请使用“/event 今天 19:30 标题”、“/event 明天 09:00 标题”或“/event 2026-08-30 09:00 标题”。';

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function noteTitle(content: string) {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim()) || '快速记录';
  const title = clean(firstLine.replace(/^#{1,6}\s+/, '')) || '快速记录';
  return title.length > 42 ? `${title.slice(0, 42)}…` : title;
}

function atLocalTime(year: number, month: number, day: number, hour: number, minute: number) {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function eventDraft(source: string, now: Date): QuickCaptureDraft {
  const relative = /^(今天|明天)\s+(\d{1,2}):(\d{2})\s+(.+)$/u.exec(source);
  const absolute = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s+(.+)$/u.exec(source);
  let date: Date | null = null;
  let title = '';

  if (relative) {
    const offset = relative[1] === '明天' ? 1 : 0;
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    date = atLocalTime(target.getFullYear(), target.getMonth() + 1, target.getDate(), Number(relative[2]), Number(relative[3]));
    title = clean(relative[4]);
  } else if (absolute) {
    date = atLocalTime(Number(absolute[1]), Number(absolute[2]), Number(absolute[3]), Number(absolute[4]), Number(absolute[5]));
    title = clean(absolute[6]);
  }

  if (!date || !title) {
    return { kind: 'event', title: '', content: '', start: null, due: null, error: EVENT_HELP };
  }

  const iso = date.toISOString();
  return { kind: 'event', title, content: '', start: iso, due: iso, error: null };
}

/**
 * 仅接受显式前缀和固定日期格式，避免由模型或模糊语义替用户创建错误事项。
 * 无前缀文本默认保留为笔记，确保快速收集不会意外变成待办。
 */
export function parseQuickCapture(input: string, now = new Date()): QuickCaptureDraft | null {
  const raw = input.trim();
  if (!raw) return null;

  const command = /^\/(\w+)(?:\s+([\s\S]*))?$/u.exec(raw);
  if (!command) {
    return { kind: 'note', title: noteTitle(raw), content: raw, start: null, due: null, error: null };
  }

  const body = (command[2] || '').trim();
  switch (command[1].toLowerCase()) {
    case 'todo':
      return body
        ? { kind: 'todo', title: clean(body), content: '', start: null, due: null, error: null }
        : { kind: 'todo', title: '', content: '', start: null, due: null, error: '待办需要标题，例如“/todo 整理作品集”。' };
    case 'note':
      return body
        ? { kind: 'note', title: noteTitle(body), content: body, start: null, due: null, error: null }
        : { kind: 'note', title: '', content: '', start: null, due: null, error: '备忘录需要内容，例如“/note 今天的想法”。' };
    case 'event':
      return eventDraft(body, now);
    default:
      return { kind: 'note', title: '', content: '', start: null, due: null, error: '仅支持 /todo、/event 和 /note；不带前缀的内容会作为备忘录保存。' };
  }
}

export function isQuickCaptureShortcut(event: Pick<KeyboardEvent, 'defaultPrevented' | 'repeat' | 'altKey' | 'metaKey' | 'ctrlKey' | 'key'>) {
  return !event.defaultPrevented
    && !event.repeat
    && !event.altKey
    && (event.metaKey || event.ctrlKey)
    && event.key.toLowerCase() === 'k';
}

export const QUICK_CAPTURE_EXAMPLES = [
  '/todo 整理作品集',
  '/event 明天 09:30 面试',
  '/note 记录一个想法',
] as const;
