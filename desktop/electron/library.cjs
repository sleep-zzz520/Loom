const fs = require('node:fs');
const path = require('node:path');
const store = require('./store.cjs');

let libraryDir = '';
const PREVIEW_LIMIT_BYTES = 25 * 1024 * 1024;

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function init(userDataDir) {
  libraryDir = path.join(userDataDir, 'library-files');
  fs.mkdirSync(libraryDir, { recursive: true });
  normalizeItemNames();
}

function mimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function list() {
  return store.getModule('profileItems');
}

function uniqueName(name, items) {
  const original = String(name || '未命名资料').trim() || '未命名资料';
  const extension = path.extname(original);
  const stem = extension ? original.slice(0, -extension.length) : original;
  const used = new Set(items.map((item) => String(item.name || '').toLocaleLowerCase()));
  if (!used.has(original.toLocaleLowerCase())) return original;
  let index = 1;
  let candidate = `${stem} (${index})${extension}`;
  while (used.has(candidate.toLocaleLowerCase())) {
    index += 1;
    candidate = `${stem} (${index})${extension}`;
  }
  return candidate;
}

function normalizeItemNames() {
  store.updateModule('profileItems', (current) => {
    const normalized = [];
    let changed = false;
    for (const item of current) {
      const name = uniqueName(item.name, normalized);
      if (name !== item.name) changed = true;
      normalized.push(name === item.name ? item : { ...item, name });
    }
    return changed ? normalized : current;
  });
}

function importFile(sourcePath, categoryId = '') {
  if (!libraryDir) throw new Error('资料库尚未初始化');
  const source = String(sourcePath || '');
  const stat = fs.statSync(source);
  if (!stat.isFile()) throw new Error('请选择一个文件');

  const id = store.newId();
  const originalName = path.basename(source);
  const storedName = `${id}${path.extname(originalName)}`;
  fs.copyFileSync(source, path.join(libraryDir, storedName));
  let item;
  const items = store.updateModule('profileItems', (current) => {
    item = {
    id,
    name: uniqueName(originalName, current),
    source: 'imported',
    categoryId: String(categoryId || ''),
    storageName: storedName,
    mimeType: mimeType(originalName),
    size: stat.size,
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    };
    return [item, ...current];
  });
  return { items, item };
}

function createDocument(categoryId = '') {
  const now = new Date().toISOString();
  let item;
  const items = store.updateModule('profileItems', (current) => {
    item = {
    id: store.newId(),
    name: uniqueName('未命名资料', current),
    source: 'created',
    categoryId: String(categoryId || ''),
    storageName: '',
    mimeType: 'text/markdown',
    size: 0,
    content: '',
    createdAt: now,
    updatedAt: now,
    };
    return [item, ...current];
  });
  return { items, item };
}

function updateItem(id, patch = {}) {
  const items = store.updateModule('profileItems', (current) => current.map((item) => {
    if (item.id !== id || (item.source !== 'created' && item.source !== 'imported')) return item;
    const others = current.filter((entry) => entry.id !== item.id);
    return {
      ...item,
      name: uniqueName(patch.name ?? item.name, others),
      categoryId: patch.categoryId === undefined ? item.categoryId : String(patch.categoryId),
      content: item.source === 'created' ? String(patch.content ?? item.content ?? '') : item.content,
      note: patch.note === undefined ? String(item.note || '') : String(patch.note ?? ''),
      updatedAt: new Date().toISOString(),
    };
  }));
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error('资料不存在');
  return { items, item };
}

function removeItem(id) {
  const item = list().find((entry) => entry.id === id);
  if (!item) throw new Error('资料不存在');
  if (item.source === 'imported' && item.storageName) {
    const filePath = path.join(libraryDir, path.basename(item.storageName));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  return store.updateModule('profileItems', (current) => current.filter((entry) => entry.id !== id));
}

function previewFile(id) {
  const item = list().find((entry) => entry.id === id && entry.source === 'imported');
  if (!item || !item.storageName) throw new Error('导入文件不存在');
  const filePath = path.join(libraryDir, path.basename(item.storageName));
  const stat = fs.statSync(filePath);
  // ponytail: 当前预览通过 IPC 一次性传输文件；超过 25MB 后应升级为受限自定义协议流式加载。
  if (stat.size > PREVIEW_LIMIT_BYTES) {
    return { available: false, reason: '文件超过 25MB，暂不支持在工作台内预览。' };
  }
  return {
    available: true,
    mimeType: item.mimeType || mimeType(filePath),
    data: fs.readFileSync(filePath).toString('base64'),
  };
}

module.exports = { init, list, importFile, createDocument, updateItem, removeItem, previewFile };

if (process.env.WORKBENCH_LIBRARY_SELF_TEST === '1') {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-library-self-test-'));
  try {
    store.init(dir);
    init(dir);
    const source = path.join(dir, 'sample.pdf');
    fs.writeFileSync(source, '%PDF-1.4 self-test');
    const imported = importFile(source).item;
    if (imported.source !== 'imported' || !fs.existsSync(path.join(libraryDir, imported.storageName))) {
      throw new Error('file import failed');
    }
    if (!previewFile(imported.id).available) throw new Error('file preview failed');
    const duplicateImport = importFile(source).item;
    if (duplicateImport.name !== 'sample (1).pdf') {
      throw new Error('duplicate import name failed');
    }
    const document = createDocument().item;
    if (updateItem(document.id, { name: '自检文档', content: 'hello' }).item.content !== 'hello') {
      throw new Error('document update failed');
    }
    if (createDocument('general').item.categoryId !== 'general') {
      throw new Error('document category assignment failed');
    }
    if (updateItem(document.id, { categoryId: 'general' }).item.categoryId !== 'general') {
      throw new Error('category update failed');
    }
    if (updateItem(imported.id, { name: '已重命名.pdf' }).item.name !== '已重命名.pdf') {
      throw new Error('file rename failed');
    }
    if (updateItem(duplicateImport.id, { name: '已重命名.pdf' }).item.name !== '已重命名 (1).pdf') {
      throw new Error('duplicate rename failed');
    }
    removeItem(imported.id);
    if (fs.existsSync(path.join(libraryDir, imported.storageName))) {
      throw new Error('file removal failed');
    }
    console.log('library self-test ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
