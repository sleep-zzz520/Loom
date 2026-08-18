import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FilePlus2, FileText, Image, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import type { Category, ProfileItem } from '../types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function sortItems(items: ProfileItem[]) {
  return items
    .filter((item) => item.source === 'imported' || item.source === 'created')
    .map((item) => ({ ...item, updatedAt: item.updatedAt || item.createdAt || new Date().toISOString() }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sourceLabel(item: ProfileItem) {
  return item.source === 'created' ? '工作台文档' : '已导入';
}

function itemIcon(item: ProfileItem) {
  return item.source === 'created' ? FileText : Image;
}

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function fingerprint(item: Pick<ProfileItem, 'id' | 'name' | 'content'>) {
  return `${item.id}\u0000${item.name}\u0000${item.content}`;
}

export default function Profile() {
  const [items, setItems] = useState<ProfileItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [categoryName, setCategoryName] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [notice, setNotice] = useState('');
  const savedRef = useRef('');

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeId) || null,
    [activeId, items]
  );

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) =>
      (categoryFilter === 'all' || item.categoryId === categoryFilter) &&
      (!needle || `${item.name}\n${item.content || ''}`.toLocaleLowerCase().includes(needle))
    );
  }, [items, query, categoryFilter]);

  useEffect(() => {
    Promise.all([window.workbench.data.getModule('profileItems'), window.workbench.data.getModule('categories')])
      .then(([saved, savedCategories]) => {
        const next = sortItems(saved);
        setItems(next);
        setCategories(savedCategories);
        if (next[0]) selectItem(next[0]);
      })
      .catch(() => setNotice('资料读取失败，请稍后重试。'));
  }, []);

  useEffect(() => {
    if (!activeItem || activeItem.source !== 'imported') {
      setPreviewUrl('');
      setPreviewError('');
      return;
    }
    let cancelled = false;
    setPreviewUrl('');
    setPreviewError('加载预览中…');
    window.workbench.library.previewFile(activeItem.id)
      .then((result) => {
        if (cancelled) return;
        if (!result.available || !result.data || !result.mimeType) {
          setPreviewError(result.reason || '该文件暂不支持预览。');
          return;
        }
        setPreviewUrl(`data:${result.mimeType};base64,${result.data}`);
        setPreviewError('');
      })
      .catch(() => !cancelled && setPreviewError('无法读取工作台中的文件副本。'));
    return () => { cancelled = true; };
  }, [activeItem?.id, activeItem?.source]);

  useEffect(() => {
    if (!activeItem) return;
    if (savedRef.current === fingerprint({ id: activeItem.id, name: title, content })) return;
    const timer = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        const result = await window.workbench.library.updateItem(
          activeItem.id,
          activeItem.source === 'created' ? { name: title, content } : { name: title }
        );
        const next = sortItems(result.items);
        setItems(next);
        savedRef.current = fingerprint(result.item);
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeItem?.id, activeItem?.source, title, content]);

  function selectItem(item: ProfileItem) {
    setActiveId(item.id);
    setTitle(item.name);
    setContent(item.content || '');
    savedRef.current = fingerprint(item);
    setSaveState('idle');
    setNotice('');
  }

  async function importFile() {
    try {
      const result = await window.workbench.library.importFile();
      if (!result) return;
      setItems(sortItems(result.items));
      selectItem(result.item);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导入文件失败。');
    }
  }

  async function createDocument() {
    try {
      const result = await window.workbench.library.createDocument();
      setItems(sortItems(result.items));
      selectItem(result.item);
    } catch {
      setNotice('新建资料失败，请稍后重试。');
    }
  }

  async function removeActiveItem() {
    if (!activeItem) return;
    const detail = activeItem.source === 'imported' ? '工作台内的文件副本会被删除，原始文件不受影响。' : '这份工作台文档会被删除。';
    if (!window.confirm(`确定删除“${activeItem.name}”？\n${detail}`)) return;
    try {
      const next = sortItems(await window.workbench.library.removeItem(activeItem.id));
      setItems(next);
      if (next[0]) selectItem(next[0]);
      else {
        setActiveId(null);
        setTitle('');
        setContent('');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '删除资料失败。');
    }
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) return;
    if (categories.some((category) => category.name === name)) {
      setNotice('该分类已存在。');
      return;
    }
    const next = [...categories, { id: crypto.randomUUID(), name }];
    setCategories(await window.workbench.data.setModule('categories', next));
    setCategoryName('');
  }

  async function removeCategory(category: Category) {
    if (items.some((item) => item.categoryId === category.id)) {
      setNotice('该分类仍有资料，调整资料分类后才能删除。');
      return;
    }
    if (!window.confirm(`确定删除分类“${category.name}”？`)) return;
    setCategories(await window.workbench.data.setModule('categories', categories.filter((item) => item.id !== category.id)));
    if (categoryFilter === category.id) setCategoryFilter('all');
  }

  async function setActiveCategory(categoryId: string) {
    if (!activeItem) return;
    try {
      const result = await window.workbench.library.updateItem(activeItem.id, { categoryId });
      setItems(sortItems(result.items));
      savedRef.current = fingerprint(result.item);
    } catch {
      setNotice('更新分类失败，请稍后重试。');
    }
  }

  const saveLabel: Record<SaveState, string> = {
    idle: '', saving: '保存中…', saved: '已保存', error: '保存失败',
  };

  return (
    <section className="module-page library-page">
      {notice && <p className="form-error library-notice">{notice}</p>}

      <div className="library-layout">
        <aside className="library-list-panel">
          <div className="library-list-head">
            <span>资料库</span><em>{items.length}</em>
            <div className="library-collection-actions">
              <button type="button" className="text-btn" onClick={createDocument}><Plus size={14} /> 新建</button>
              <button type="button" className="text-btn" onClick={importFile}><Upload size={14} /> 导入</button>
            </div>
          </div>
          <div className="library-categories">
            <button type="button" className={`library-category${categoryFilter === 'all' ? ' active' : ''}`} onClick={() => setCategoryFilter('all')}><span>全部资料</span><em>{items.length}</em></button>
            {categories.map((category) => <div key={category.id} className={`library-category-row${categoryFilter === category.id ? ' active' : ''}`}><button type="button" className="library-category" onClick={() => setCategoryFilter(category.id)}><span>{category.name}</span><em>{items.filter((item) => item.categoryId === category.id).length}</em></button><button type="button" className="library-category-delete" aria-label={`删除分类${category.name}`} onClick={() => removeCategory(category)}><X size={13} /></button></div>)}
            <form className="library-category-add" onSubmit={saveCategory}><input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="新分类" aria-label="新分类" /><button type="submit" aria-label="添加分类"><Plus size={15} /></button></form>
          </div>
          <label className="library-search">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资料" aria-label="搜索资料" />
            {query && <button type="button" className="library-search-clear" aria-label="清空搜索" onClick={() => setQuery('')}><X size={14} /></button>}
          </label>
          <div className="library-list">
            {visibleItems.length ? visibleItems.map((item) => {
              const Icon = itemIcon(item);
              return (
                <button key={item.id} type="button" className={`library-list-item${item.id === activeId ? ' active' : ''}`} onClick={() => selectItem(item)}>
                  <span className={`library-item-icon ${item.source}`}><Icon size={16} /></span>
                  <span className="library-item-copy"><strong>{item.name}</strong><small>{sourceLabel(item)} · {formatUpdatedAt(item.updatedAt)}</small></span>
                </button>
              );
            }) : <p className="library-list-empty">{items.length ? '没有匹配的资料' : '还没有资料'}</p>}
          </div>
        </aside>

        <div className="library-viewer-panel">
          {!activeItem ? (
            <div className="library-empty"><FilePlus2 size={24} /><p>导入一个 PDF 或图片，或者新建一份工作台资料。</p></div>
          ) : activeItem.source === 'created' ? (
            <>
              <div className="library-editor-toolbar"><span className="library-source"><FileText size={15} /> 工作台文档</span><span className="library-toolbar-actions"><select className="library-category-select" value={activeItem.categoryId} onChange={(event) => setActiveCategory(event.target.value)} aria-label="资料分类"><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><span className={`notes-save-state ${saveState}`}>{saveLabel[saveState]}</span><button type="button" className="text-btn danger-text" onClick={removeActiveItem}><Trash2 size={15} /> 删除</button></span></div>
              <input className="library-title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="资料标题" aria-label="资料标题" />
              <textarea className="library-content-input" value={content} onChange={(event) => setContent(event.target.value)} placeholder="开始记录…" aria-label="资料内容" />
            </>
          ) : (
            <>
              <div className="library-editor-toolbar"><span className="library-source"><Image size={15} /> 已导入到工作台</span><span className="library-toolbar-actions"><select className="library-category-select" value={activeItem.categoryId} onChange={(event) => setActiveCategory(event.target.value)} aria-label="资料分类"><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><span className={`notes-save-state ${saveState}`}>{saveLabel[saveState]}</span><button type="button" className="text-btn danger-text" onClick={removeActiveItem}><Trash2 size={15} /> 删除</button></span></div>
              <input className="library-title-input library-import-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="资料标题" aria-label="资料标题" />
              {previewUrl && activeItem.mimeType.startsWith('image/') ? <img className="library-image-preview" src={previewUrl} alt={activeItem.name} /> : null}
              {previewUrl && activeItem.mimeType === 'application/pdf' ? <iframe className="library-pdf-preview" src={previewUrl} title={activeItem.name} /> : null}
              {!previewUrl && <div className="library-empty"><FileText size={24} /><p>{previewError}</p></div>}
              {previewUrl && !activeItem.mimeType.startsWith('image/') && activeItem.mimeType !== 'application/pdf' ? <div className="library-empty"><FileText size={24} /><p>该文件已复制到工作台，当前版本暂不支持此格式的内部预览。</p></div> : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
