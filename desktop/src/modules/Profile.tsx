import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, FilePlus2, FileText, Image, Maximize2, MoreHorizontal, Plus, RotateCcw, Search, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Category, ProfileItem } from '../types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type SortKey = 'updatedAt' | 'name' | 'createdAt';
type SortDirection = 'asc' | 'desc';
type ProfileItemPatch = Partial<Pick<ProfileItem, 'name' | 'content' | 'categoryId' | 'note'>>;
type ProfileProps = { initialCategoryFilter?: string };

const DEFAULT_SORT_DIRECTIONS: Record<SortKey, SortDirection> = {
  updatedAt: 'desc',
  name: 'asc',
  createdAt: 'desc',
};

function sortItems(items: ProfileItem[], sortKey: SortKey = 'updatedAt', direction: SortDirection = 'desc') {
  const normalized = items
    .filter((item) => item.source === 'imported' || item.source === 'created')
    .map((item) => ({ ...item, updatedAt: item.updatedAt || item.createdAt || new Date().toISOString() }));

  return normalized.sort((a, b) => {
    const comparison = sortKey === 'name'
      ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
      : String(a[sortKey]).localeCompare(String(b[sortKey]));
    return direction === 'asc' ? comparison : -comparison;
  });
}

function sourceLabel(item: ProfileItem) {
  if (item.source === 'created') return '工作台文档';
  const extension = item.name.includes('.') ? item.name.slice(item.name.lastIndexOf('.') + 1).toUpperCase() : '';
  return extension ? `已导入 · ${extension}` : '已导入';
}

function itemIcon(item: ProfileItem) {
  return item.source === 'created' ? FileText : Image;
}

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function formatFileSize(size: number) {
  if (!size) return '';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatContentSize(content: string) {
  const bytes = new TextEncoder().encode(content).length;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function listTimeLabel(item: ProfileItem, sortKey: SortKey) {
  if (sortKey === 'createdAt') return `${item.source === 'imported' ? '导入于' : '创建于'} ${formatUpdatedAt(item.createdAt)}`;
  return `修改于 ${formatUpdatedAt(item.updatedAt)}`;
}

function fingerprint(item: Pick<ProfileItem, 'id' | 'name' | 'content'> & { note?: string }) {
  return `${item.id}\u0000${item.name}\u0000${item.content}\u0000${item.note || ''}`;
}

function publishProfileItems(items: ProfileItem[]) {
  window.dispatchEvent(new CustomEvent('workbench:profile-items', { detail: items }));
}

function isUncategorized(item: ProfileItem, categories: Category[]) {
  return !item.categoryId || !categories.some((category) => category.id === item.categoryId);
}

export default function Profile({ initialCategoryFilter = 'all' }: ProfileProps) {
  const [items, setItems] = useState<ProfileItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(initialCategoryFilter);
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [infoOpen, setInfoOpen] = useState(false);
  const [note, setNote] = useState('');
  const [itemMenuId, setItemMenuId] = useState<string | null>(null);
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [migratingItem, setMigratingItem] = useState<ProfileItem | null>(null);
  const [migrationDestination, setMigrationDestination] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [notice, setNotice] = useState('');
  const [listWidth, setListWidth] = useState(480);
  const [resizingList, setResizingList] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggingPreview, setDraggingPreview] = useState(false);
  const profileRef = useRef<HTMLElement | null>(null);
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const previewDragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const renameSavingRef = useRef(false);
  const savedRef = useRef('');

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeId) || null,
    [activeId, items]
  );

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = items.filter((item) =>
      (categoryFilter === 'all' || (categoryFilter === 'uncategorized' ? isUncategorized(item, categories) : item.categoryId === categoryFilter)) &&
      (!needle || `${item.name}\n${item.content || ''}`.toLocaleLowerCase().includes(needle))
    );
    return sortItems(filtered, sortKey, sortDirection);
  }, [items, query, categoryFilter, categories, sortKey, sortDirection]);

  const activeFilterLabel = categoryFilter === 'all'
    ? '全部资料'
    : categoryFilter === 'uncategorized'
      ? '未分类'
      : categories.find((category) => category.id === categoryFilter)?.name || '全部资料';

  const activeCategoryId = categoryFilter !== 'all' && categoryFilter !== 'uncategorized' && categories.some((category) => category.id === categoryFilter)
    ? categoryFilter
    : '';

  useEffect(() => {
    Promise.all([window.workbench.data.getModule('profileItems'), window.workbench.data.getModule('categories')])
      .then(([saved, savedCategories]) => {
        const next = sortItems(saved);
        setItems(next);
        setCategories(savedCategories);
        publishProfileItems(saved);
        if (next[0]) selectItem(next[0]);
      })
      .catch(() => setNotice('资料读取失败，请稍后重试。'));
  }, []);

  useEffect(() => {
    const handleProfileItems = (event: Event) => {
      const items = (event as CustomEvent<ProfileItem[]>).detail;
      if (Array.isArray(items)) setItems(sortItems(items));
    };
    const handleCategoryFilter = (event: Event) => {
      const filter = (event as CustomEvent<string>).detail;
      if (filter) setCategoryFilter(filter);
    };
    const handleCategories = (event: Event) => {
      setCategories((event as CustomEvent<Category[]>).detail || []);
    };
    window.addEventListener('workbench:profile-items', handleProfileItems);
    window.addEventListener('workbench:profile-category', handleCategoryFilter);
    window.addEventListener('workbench:profile-categories', handleCategories);
    return () => {
      window.removeEventListener('workbench:profile-items', handleProfileItems);
      window.removeEventListener('workbench:profile-category', handleCategoryFilter);
      window.removeEventListener('workbench:profile-categories', handleCategories);
    };
  }, []);

  useEffect(() => {
    if (!resizingList) return;
    const handleMove = (event: PointerEvent) => {
      const left = profileRef.current?.getBoundingClientRect().left || 0;
      setListWidth(Math.min(620, Math.max(320, event.clientX - left)));
    };
    const stopResizing = () => setResizingList(false);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopResizing);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopResizing);
    };
  }, [resizingList]);

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

  async function updateProfileItem(id: string, patch: ProfileItemPatch) {
    const before = await window.workbench.data.getModule('profileItems');
    const previous = before.find((item) => item.id === id);
    let result = await window.workbench.library.updateItem(id, patch);
    const expectedNote = patch.note === undefined ? previous?.note || '' : patch.note;
    if ((result.item.note || '') !== expectedNote) {
      const persisted = await window.workbench.data.setModule('profileItems', result.items.map((item) => item.id === id ? { ...item, note: expectedNote } : item));
      const item = persisted.find((entry) => entry.id === id);
      if (!item) throw new Error('资料不存在');
      result = { items: persisted, item };
    }
    return result;
  }

  useEffect(() => {
    if (!activeItem) return;
    if (savedRef.current === fingerprint({ id: activeItem.id, name: title, content, note })) return;
    const timer = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        const result = await updateProfileItem(
          activeItem.id,
          activeItem.source === 'created' ? { name: title, content, note } : { name: title, note }
        );
        const next = sortItems(result.items);
        setItems(next);
        publishProfileItems(result.items);
        savedRef.current = fingerprint(result.item);
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeItem?.id, activeItem?.source, title, content, note]);

  function selectItem(item: ProfileItem) {
    setActiveId(item.id);
    setTitle(item.name);
    setContent(item.content || '');
    setNote(item.note || '');
    savedRef.current = fingerprint(item);
    setSaveState('idle');
    setNotice('');
    setItemMenuId(null);
    setInfoOpen(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setImageDimensions({ width: 0, height: 0 });
  }

  function startRename(item: ProfileItem) {
    setItemMenuId(null);
    setRenamingItemId(item.id);
    setRenameDraft(item.name);
  }

  function cancelRename() {
    setRenamingItemId(null);
    setRenameDraft('');
  }

  async function saveItemRename(item: ProfileItem) {
    const name = renameDraft.trim();
    if (name === item.name) {
      cancelRename();
      return;
    }
    if (!name) {
      cancelRename();
      return;
    }
    if (renameSavingRef.current) return;
    renameSavingRef.current = true;
    cancelRename();
    try {
      const result = await updateProfileItem(item.id, { name });
      setItems(sortItems(result.items));
      publishProfileItems(result.items);
      if (activeId === item.id) {
        setTitle(result.item.name);
        savedRef.current = fingerprint(result.item);
      }
    } catch {
      setNotice('重命名失败，请稍后重试。');
    } finally {
      renameSavingRef.current = false;
    }
  }

  function openMigration(item: ProfileItem) {
    setItemMenuId(null);
    setMigrationDestination(item.categoryId || '');
    setMigratingItem(item);
  }

  async function migrateItem() {
    if (!migratingItem) return;
    if (migrationDestination === migratingItem.categoryId) {
      setMigratingItem(null);
      return;
    }
    try {
      const result = await updateProfileItem(migratingItem.id, { categoryId: migrationDestination });
      setItems(sortItems(result.items));
      publishProfileItems(result.items);
      if (activeId === migratingItem.id) savedRef.current = fingerprint(result.item);
      setMigratingItem(null);
    } catch {
      setNotice('迁移失败，请稍后重试。');
    }
  }

  function resetPreview() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function changeZoom(next: number) {
    const value = Math.min(3, Math.max(0.25, Math.round(next * 20) / 20));
    setZoom(value);
    if (value <= 1) setPan({ x: 0, y: 0 });
  }

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      if (!previewUrl || !activeItem?.mimeType.startsWith('image/')) return;
      event.preventDefault();
      event.stopPropagation();
      changeZoom(zoom * (event.deltaY > 0 ? 0.9 : 1.1));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [activeItem?.mimeType, previewUrl, zoom]);

  function startPreviewDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || zoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    previewDragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setDraggingPreview(true);
  }

  function movePreview(event: ReactPointerEvent<HTMLDivElement>) {
    if (!previewDragRef.current) return;
    const start = previewDragRef.current;
    setPan({ x: start.panX + event.clientX - start.x, y: start.panY + event.clientY - start.y });
  }

  function stopPreviewDrag() {
    previewDragRef.current = null;
    setDraggingPreview(false);
  }

  async function importFile() {
    try {
      let result = await window.workbench.library.importFile(activeCategoryId);
      if (!result) return;
      if (activeCategoryId && result.item.categoryId !== activeCategoryId) {
        result = await updateProfileItem(result.item.id, { categoryId: activeCategoryId });
      }
      setItems(sortItems(result.items));
      publishProfileItems(result.items);
      selectItem(result.item);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导入文件失败。');
    }
  }

  async function createDocument() {
    try {
      let result = await window.workbench.library.createDocument(activeCategoryId);
      if (activeCategoryId && result.item.categoryId !== activeCategoryId) {
        result = await updateProfileItem(result.item.id, { categoryId: activeCategoryId });
      }
      setItems(sortItems(result.items));
      publishProfileItems(result.items);
      selectItem(result.item);
    } catch {
      setNotice('新建资料失败，请稍后重试。');
    }
  }

  async function removeItem(item: ProfileItem) {
    const detail = item.source === 'imported' ? '工作台内的文件副本会被删除，原始文件不受影响。' : '这份工作台文档会被删除。';
    if (!window.confirm(`确定删除“${item.name}”？\n${detail}`)) return;
    try {
      const next = sortItems(await window.workbench.library.removeItem(item.id));
      setItems(next);
      publishProfileItems(next);
      setItemMenuId(null);
      const replacement = visibleItems.find((candidate) => candidate.id !== item.id);
      if (activeId === item.id && replacement) selectItem(replacement);
      else if (activeId === item.id) {
        setActiveId(null);
        setTitle('');
        setContent('');
        setNote('');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '删除资料失败。');
    }
  }

  function removeActiveItem() {
    if (activeItem) void removeItem(activeItem);
  }

  async function setActiveCategory(categoryId: string) {
    if (!activeItem) return;
    try {
      const result = await updateProfileItem(activeItem.id, { categoryId });
      setItems(sortItems(result.items));
      publishProfileItems(result.items);
      savedRef.current = fingerprint(result.item);
    } catch {
      setNotice('更新分类失败，请稍后重试。');
    }
  }

  const saveLabel: Record<SaveState, string> = {
    idle: '', saving: '保存中…', saved: '已保存', error: '保存失败',
  };

  return (
    <section className="module-page library-page" ref={profileRef} style={{ '--library-list-width': `${listWidth}px` } as CSSProperties}>
      {notice && <p className="form-error library-notice">{notice}</p>}

      <div className="library-layout">
        <aside className="library-list-panel">
          <div className="library-list-head">
            <span>{activeFilterLabel}</span><em>{visibleItems.length}</em>
            <div className="library-collection-actions">
              <button type="button" className="library-new-button" aria-label="新建资料" title="新建资料" onClick={createDocument}><Plus size={18} /></button>
              <button type="button" className="library-import-button" onClick={importFile}><Upload size={15} /> 导入</button>
            </div>
          </div>
          <div className="library-list-tools">
            <label className="library-search">
              <Search size={14} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资料" aria-label="搜索资料" />
              {query && <button type="button" className="library-search-clear" aria-label="清空搜索" onClick={() => setQuery('')}><X size={14} /></button>}
            </label>
            <label className="library-sort-control" title="选择排序字段">
              <select className="library-sort-select" value={sortKey} onChange={(event) => { const nextKey = event.target.value as SortKey; setSortKey(nextKey); setSortDirection(DEFAULT_SORT_DIRECTIONS[nextKey]); }} aria-label="排序字段">
                <option value="updatedAt">最近修改</option>
                <option value="name">名称</option>
                <option value="createdAt">创建时间</option>
              </select>
            </label>
            <button type="button" className="library-sort-direction" onClick={() => setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc')} aria-label="切换排序顺序" title={sortDirection === 'asc' ? '当前为升序，点击切换为降序' : '当前为降序，点击切换为升序'}>{sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</button>
          </div>
          <div className="library-list">
            {visibleItems.length ? visibleItems.map((item) => {
              const Icon = itemIcon(item);
              return (
                <div key={item.id} className={`library-list-row${item.id === activeId ? ' active' : ''}`}>
                  {renamingItemId === item.id ? <div className="library-list-item library-list-item-editing" onClick={(event) => event.stopPropagation()}>
                    <span className={`library-item-icon ${item.source}`}>
                      {item.id === activeId && previewUrl && item.source === 'imported' && item.mimeType.startsWith('image/') ? <img src={previewUrl} alt="" /> : <Icon size={16} />}
                    </span>
                    <span className="library-item-copy"><input autoFocus className="library-item-rename-input" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onBlur={() => { if (renameDraft.trim()) void saveItemRename(item); else cancelRename(); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveItemRename(item); } if (event.key === 'Escape') { event.preventDefault(); cancelRename(); } }} aria-label={`重命名：${item.name}`} /><small>{sourceLabel(item)} · {listTimeLabel(item, sortKey)}</small></span>
                  </div> : <button type="button" className="library-list-item" onClick={() => selectItem(item)}>
                    <span className={`library-item-icon ${item.source}`}>
                      {item.id === activeId && previewUrl && item.source === 'imported' && item.mimeType.startsWith('image/') ? <img src={previewUrl} alt="" /> : <Icon size={16} />}
                    </span>
                    <span className="library-item-copy"><strong>{item.name}</strong><small>{sourceLabel(item)} · {listTimeLabel(item, sortKey)}</small></span>
                  </button>}
                  <button type="button" className="library-item-more" aria-label={`更多操作：${item.name}`} title="更多操作" onClick={(event) => { event.stopPropagation(); setItemMenuId((current) => current === item.id ? null : item.id); }}><MoreHorizontal size={17} /></button>
                  {itemMenuId === item.id && <div className="library-item-menu" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => startRename(item)}>重命名</button><button type="button" onClick={() => openMigration(item)}>迁移</button><button type="button" className="danger-text" onClick={() => void removeItem(item)}>删除</button></div>}
                </div>
              );
            }) : <p className="library-list-empty">{items.length ? '没有匹配的资料' : '还没有资料'}</p>}
          </div>
        </aside>
        <div
          className={`library-resizer${resizingList ? ' is-dragging' : ''}`}
          role="separator"
          aria-label="调整资料列表宽度"
          aria-orientation="vertical"
          onPointerDown={(event) => {
            event.preventDefault();
            setResizingList(true);
          }}
        />

        <div className="library-viewer-panel">
          {!activeItem ? (
            <div className="library-empty"><FilePlus2 size={24} /><p>导入一个 PDF 或图片，或者新建一份工作台资料。</p></div>
          ) : activeItem.source === 'created' ? (
            <>
              <div className="library-editor-toolbar">
                <div className="library-file-heading"><FileText size={16} /><span><strong>{title || '未命名资料'}</strong><small>工作台文档 · 创建于 {formatUpdatedAt(activeItem.createdAt)} · 修改于 {formatUpdatedAt(activeItem.updatedAt)}</small></span></div>
                <div className="library-toolbar-actions">
                  <select className="library-category-select" value={activeItem.categoryId} onChange={(event) => setActiveCategory(event.target.value)} aria-label="资料分类"><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                  <span className={`notes-save-state ${saveState}`}>{saveLabel[saveState]}</span>
                  <button type="button" className="library-viewer-delete danger-text" aria-label="删除资料" title="删除资料" onClick={removeActiveItem}><Trash2 size={18} /></button>
                </div>
              </div>
              <input className="library-title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="资料标题" aria-label="资料标题" />
              <textarea className="library-content-input" value={content} onChange={(event) => setContent(event.target.value)} placeholder="开始记录…" aria-label="资料内容" />
            </>
          ) : (
            <>
              <div className="library-editor-toolbar">
                <div className="library-file-heading"><span><span className="library-title-line"><input className="library-title-inline" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="资料标题" aria-label="资料标题" /></span><small>{activeItem.name.includes('.') ? activeItem.name.slice(activeItem.name.lastIndexOf('.') + 1).toUpperCase() : '文件'} · {formatFileSize(activeItem.size)} · 导入于 {formatUpdatedAt(activeItem.createdAt)} · 修改于 {formatUpdatedAt(activeItem.updatedAt)}</small></span></div>
                <div className="library-toolbar-actions">
                  <select className="library-category-select" value={activeItem.categoryId} onChange={(event) => setActiveCategory(event.target.value)} aria-label="资料分类"><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                  <span className={`notes-save-state ${saveState}`}>{saveLabel[saveState]}</span>
                  <button type="button" className="library-viewer-delete danger-text" aria-label="删除资料" title="删除资料" onClick={removeActiveItem}><Trash2 size={18} /></button>
                </div>
              </div>
              <div
                className={`library-preview-canvas${draggingPreview ? ' is-dragging' : ''}`}
                ref={previewCanvasRef}
                onPointerDown={startPreviewDrag}
                onPointerMove={movePreview}
                onPointerUp={stopPreviewDrag}
                onPointerCancel={stopPreviewDrag}
              >
                {previewUrl && activeItem.mimeType.startsWith('image/') ? <div className="library-preview-stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}><img className="library-image-preview" src={previewUrl} alt={activeItem.name} onLoad={(event) => setImageDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /></div> : null}
                {previewUrl && activeItem.mimeType === 'application/pdf' ? <iframe className="library-pdf-preview" src={previewUrl} title={activeItem.name} sandbox="" referrerPolicy="no-referrer" /> : null}
                {!previewUrl && <div className="library-empty"><FileText size={24} /><p>{previewError}</p></div>}
                {previewUrl && !activeItem.mimeType.startsWith('image/') && activeItem.mimeType !== 'application/pdf' ? <div className="library-empty"><FileText size={24} /><p>该文件已复制到工作台，当前版本暂不支持此格式的内部预览。</p></div> : null}
              </div>
              {previewUrl && activeItem.mimeType.startsWith('image/') && <div className="library-preview-controls"><button type="button" className="preview-control" onClick={resetPreview} title="适应窗口"><Maximize2 size={15} /></button><button type="button" className="preview-control-icon" onClick={() => changeZoom(zoom - 0.1)} aria-label="缩小"><ZoomOut size={16} /></button><span className="preview-zoom-value">{Math.round(zoom * 100)}%</span><button type="button" className="preview-control-icon" onClick={() => changeZoom(zoom + 0.1)} aria-label="放大"><ZoomIn size={16} /></button><button type="button" className="preview-control" onClick={() => changeZoom(1)} aria-pressed={zoom === 1}>100%</button><button type="button" className="preview-control-icon" onClick={resetPreview} aria-label="重置预览"><RotateCcw size={15} /></button></div>}
            </>
          )}
          {activeItem && <>
            <section className="library-note-panel"><textarea className="library-note-input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="添加备注…" aria-label="资料备注" rows={1} /></section>
            <section className={`library-info-panel${infoOpen ? ' is-open' : ''}`}>
              <button type="button" className="library-info-toggle" aria-expanded={infoOpen} onClick={() => setInfoOpen((open) => !open)}><span><ChevronDown size={16} /><strong>详细信息</strong></span><small>{infoOpen ? '收起' : '查看'}</small></button>
              {infoOpen && <div className="library-info-grid"><div><span>类型</span><strong>{activeItem.source === 'created' ? '工作台文档' : activeItem.mimeType === 'application/pdf' ? 'PDF 文档' : 'JPG 图像'}</strong></div><div><span>大小</span><strong>{activeItem.source === 'created' ? formatContentSize(content) : formatFileSize(activeItem.size)}</strong></div>{activeItem.source === 'imported' && <div><span>分辨率</span><strong>{imageDimensions.width ? `${imageDimensions.width} × ${imageDimensions.height}` : '—'}</strong></div>}<div><span>创建时间</span><strong>{formatUpdatedAt(activeItem.createdAt)}</strong></div><div><span>修改时间</span><strong>{formatUpdatedAt(activeItem.updatedAt)}</strong></div><div className="library-info-path"><span>路径</span><strong>资料 / 全部资料 / {activeItem.name}</strong></div></div>}
            </section>
          </>}
        </div>
      </div>
      {migratingItem && <div className="item-migrate-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setMigratingItem(null); }}>
        <section className="item-migrate-dialog" role="dialog" aria-modal="true" aria-labelledby="item-migrate-title" onMouseDown={(event) => event.stopPropagation()}>
          <h2 id="item-migrate-title">迁移资料</h2>
          <p>{migratingItem.name}</p>
          <label>迁移到<select value={migrationDestination} onChange={(event) => setMigrationDestination(event.target.value)} aria-label="资料迁移目标分类"><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <div className="item-migrate-actions"><button type="button" onClick={() => setMigratingItem(null)}>取消</button><button type="button" className="primary" onClick={() => void migrateItem()}>迁移</button></div>
        </section>
      </div>}
    </section>
  );
}
