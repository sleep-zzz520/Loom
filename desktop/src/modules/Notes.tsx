import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, FilePlus2, PenLine, Search, Trash2 } from 'lucide-react';
import type { Note } from '../types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function sortNotes(items: Note[]) {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function excerpt(content: string) {
  return content.replace(/\s+/g, ' ').trim() || '空白笔记';
}

function fingerprint(note: Pick<Note, 'id' | 'title' | 'content'>) {
  return `${note.id}\u0000${note.title}\u0000${note.content}`;
}

function MarkdownPreview({ content }: { content: string }) {
  if (!content.trim()) return <p className="notes-preview-empty">开始记录吧。</p>;

  return (
    <div className="notes-preview-body">
      {content.split('\n').map((line, index) => {
        if (line.startsWith('### ')) return <h3 key={index}>{line.slice(4)}</h3>;
        if (line.startsWith('## ')) return <h2 key={index}>{line.slice(3)}</h2>;
        if (line.startsWith('# ')) return <h1 key={index}>{line.slice(2)}</h1>;
        if (line.startsWith('- [ ] ') || line.startsWith('- [x] ')) {
          return <p key={index} className="notes-check-item">{line.slice(2)}</p>;
        }
        if (line.startsWith('- ') || line.startsWith('* ')) return <p key={index} className="notes-markdown-list-item">{line.slice(2)}</p>;
        if (!line.trim()) return <br key={index} />;
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const savedRef = useRef('');

  useEffect(() => {
    window.workbench.workspace.notes
      .list()
      .then((items) => {
        const next = sortNotes(items);
        setNotes(next);
        if (next[0]) selectNote(next[0]);
      })
      .catch(() => setSaveState('error'));
  }, []);

  async function save(input = { id: activeId ?? undefined, title, content }) {
    if (!input.title.trim() && !input.content.trim()) return;
    if (savedRef.current === fingerprint({ id: input.id ?? '', title: input.title, content: input.content })) return;
    setSaveState('saving');
    try {
      const next = sortNotes(await window.workbench.workspace.notes.save(input));
      setNotes(next);
      const saved = input.id ? next.find((note) => note.id === input.id) : next[0];
      if (saved) {
        savedRef.current = fingerprint(saved);
        setActiveId(saved.id);
      }
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  useEffect(() => {
    if (!title.trim() && !content.trim()) return;
    if (savedRef.current === fingerprint({ id: activeId ?? '', title, content })) return;
    const timer = window.setTimeout(() => save(), 600);
    return () => window.clearTimeout(timer);
  }, [activeId, title, content]);

  function selectNote(note: Note) {
    savedRef.current = fingerprint(note);
    setActiveId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setView('edit');
    setSaveState('idle');
  }

  async function createNote() {
    await save();
    savedRef.current = '';
    setActiveId(null);
    setTitle('');
    setContent('');
    setView('edit');
    setSaveState('idle');
  }

  async function removeNote() {
    if (!activeId || !window.confirm('确定删除这篇备忘录吗？')) return;
    try {
      const next = sortNotes(await window.workbench.workspace.notes.remove(activeId));
      setNotes(next);
      if (next[0]) {
        selectNote(next[0]);
      } else {
        savedRef.current = '';
        setActiveId(null);
        setTitle('');
        setContent('');
      }
    } catch {
      setSaveState('error');
    }
  }

  const filteredNotes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return notes;
    return notes.filter((note) =>
      `${note.title}\n${note.content}`.toLocaleLowerCase().includes(needle)
    );
  }, [notes, query]);

  const saveLabel: Record<SaveState, string> = {
    idle: '',
    saving: '保存中…',
    saved: '已保存',
    error: '保存失败',
  };

  return (
    <section className="module-page notes-page">
      <div className="notes-layout">
        <aside className="notes-list-panel">
          <div className="notes-list-toolbar">
            <span>笔记</span>
            <button type="button" className="text-btn" onClick={createNote}>
              <FilePlus2 size={14} /> 新建
            </button>
          </div>
          <label className="notes-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索笔记" />
          </label>
          <div className="notes-list">
            {filteredNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                className={`note-list-item${note.id === activeId ? ' active' : ''}`}
                onClick={() => selectNote(note)}
              >
                <strong>{note.title || '未命名笔记'}</strong>
                <span>{excerpt(note.content)}</span>
                <time>{formatUpdatedAt(note.updatedAt)}</time>
              </button>
            ))}
            {filteredNotes.length === 0 && <p className="notes-empty">{query ? '没有匹配的笔记' : '新建一篇笔记开始记录'}</p>}
          </div>
        </aside>

        <div className="notes-editor-panel">
          <div className="notes-editor-toolbar">
            <span className={`notes-save-state ${saveState}`}>{saveLabel[saveState]}</span>
            <div className="notes-editor-actions">
              <button type="button" className={`text-btn${view === 'edit' ? ' active' : ''}`} aria-pressed={view === 'edit'} onClick={() => setView('edit')}>
                <PenLine size={14} /> 编辑
              </button>
              <button type="button" className={`text-btn${view === 'preview' ? ' active' : ''}`} aria-pressed={view === 'preview'} onClick={() => setView('preview')}>
                <Eye size={14} /> 预览
              </button>
              <button type="button" className="icon-btn" aria-label="删除笔记" disabled={!activeId} onClick={removeNote}>
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          <input className="note-title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="未命名笔记" aria-label="笔记标题" />
          {view === 'edit' ? (
            <textarea className="note-content-input" value={content} onChange={(event) => setContent(event.target.value)} placeholder="支持 Markdown：# 标题、- 列表、- [ ] 待办" aria-label="笔记内容" />
          ) : (
            <div className="notes-preview"><MarkdownPreview content={content} /></div>
          )}
        </div>
      </div>
    </section>
  );
}
