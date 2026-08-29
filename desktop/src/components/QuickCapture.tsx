import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, FileText, ListTodo, X } from 'lucide-react';
import { QUICK_CAPTURE_EXAMPLES, parseQuickCapture, type QuickCaptureDraft } from './captureParser';

type QuickCaptureProps = {
  open: boolean;
  onClose: () => void;
  onNavigate: (target: 'todos' | 'calendar' | 'notes') => void;
};

const CAPTURE_LABEL: Record<QuickCaptureDraft['kind'], string> = {
  todo: '待办',
  event: '日程',
  note: '备忘录',
};

const CAPTURE_ACTION: Record<QuickCaptureDraft['kind'], string> = {
  todo: '保存到待办',
  event: '保存到日历',
  note: '保存到备忘录',
};

function CaptureIcon({ kind }: { kind: QuickCaptureDraft['kind'] }) {
  if (kind === 'todo') return <ListTodo size={16} aria-hidden="true" />;
  if (kind === 'event') return <CalendarDays size={16} aria-hidden="true" />;
  return <FileText size={16} aria-hidden="true" />;
}

function eventTime(value: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export default function QuickCapture({ open, onClose, onNavigate }: QuickCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<QuickCaptureDraft | null>(null);
  const draft = useMemo(() => parseQuickCapture(value), [value]);

  function close() {
    if (saving) return;
    setValue('');
    setError('');
    setSaved(null);
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, saving]);

  async function saveDraft() {
    if (!draft || draft.error || saving) return;
    setSaving(true);
    setError('');
    try {
      if (draft.kind === 'todo') {
        await window.workbench.workspace.todos.create({ title: draft.title, priority: 'medium' });
      } else if (draft.kind === 'event') {
        await window.workbench.workspace.todos.create({ title: draft.title, priority: 'medium', start: draft.start, due: draft.due });
      } else {
        await window.workbench.workspace.notes.save({ title: draft.title, content: draft.content });
      }
      setSaved(draft);
      setValue('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const target = saved?.kind === 'event' ? 'calendar' : saved?.kind === 'note' ? 'notes' : 'todos';

  return (
    <div className="quick-capture-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
      <section className="quick-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-capture-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="quick-capture-head">
          <div><p>快速收集 <kbd>⌘ K</kbd></p><h2 id="quick-capture-title">先记下来，再决定怎么处理</h2></div>
          <button type="button" className="quick-capture-close" onClick={close} aria-label="关闭快速收集" title="关闭"><X size={17} /></button>
        </header>

        <label className="quick-capture-input-wrap">
          <span className="sr-only">快速收集内容</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => { setValue(event.target.value); setError(''); setSaved(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveDraft(); } }}
            placeholder="输入一句话，或使用 /todo、/event、/note"
            aria-describedby="quick-capture-help"
            disabled={saving}
          />
        </label>
        <p id="quick-capture-help" className="quick-capture-help">例如：{QUICK_CAPTURE_EXAMPLES.join('　')}</p>

        {draft && <div className={`quick-capture-draft is-${draft.kind}`} aria-live="polite">
          <div className="quick-capture-draft-icon"><CaptureIcon kind={draft.kind} /></div>
          <div>
            <span>{CAPTURE_LABEL[draft.kind]}草稿</span>
            <strong>{draft.error || draft.title}</strong>
            {!draft.error && <small>{draft.kind === 'event' ? eventTime(draft.start) : draft.kind === 'note' ? `${draft.content.length} 个字符，将保存为备忘录` : '默认中优先级，可稍后补充截止时间'}</small>}
          </div>
        </div>}

        {error && <p className="quick-capture-error" role="status">{error}</p>}
        {saved ? <div className="quick-capture-saved" role="status"><Check size={16} /><span>已保存“{saved.title}”</span><button type="button" onClick={() => { close(); onNavigate(target); }}>查看{CAPTURE_LABEL[saved.kind]} </button></div> : <footer className="quick-capture-actions"><button type="button" className="quick-capture-cancel" onClick={close} disabled={saving}>取消</button><button type="button" className="quick-capture-save" onClick={() => void saveDraft()} disabled={!draft || !!draft.error || saving}>{draft ? CAPTURE_ACTION[draft.kind] : '保存草稿'}</button></footer>}
      </section>
    </div>
  );
}
