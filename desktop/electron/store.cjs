const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let dataFile = '';
let backupDir = '';
let lastAutomaticBackupAt = 0;
const MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024;
const AUTOMATIC_BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RECENT_AUTOMATIC_BACKUPS = 10;
const DAILY_BACKUP_RETENTION_DAYS = 14;

const DEFAULT_DATA = {
  schemaVersion: 6,
  settings: {
    profile: {
      name: '',
      nickname: '',
      role: '',
      about: '',
      currentFocus: '',
      avatarDataUrl: '',
      responseLength: 'balanced',
      confirmationMode: 'mutations-only',
      preferences: [],
    },
    email: {
      host: '',
      port: 993,
      secure: true,
      user: '',
      pass: '',
      smtpHost: '',
      smtpPort: 465,
      smtpSecure: true,
    },
    netease: { apiBase: 'http://127.0.0.1:3000' },
    notify: {
      ntfyUrl: 'https://ntfy.sh',
      ntfyTopic: '',
      barkUrl: '',
      channel: 'ntfy',
      reminderMinutes: [1440, 240, 60],
      quietHours: { start: '22:00', end: '08:00' },
      maxDailyNotifications: 5,
      importantDates: [],
    },
    agent: {
      apiBase: '',
      apiKey: '',
      model: '',
      proactiveEnabled: true,
      // 邮件正文可能包含私人信息；只有用户在设置中明确开启后，才启动后台分诊并发送候选邮件摘要给 Agent 模型判断。
      emailMonitorEnabled: false,
      persona: {
        name: 'Agent',
        personality: 'calm',
        proactiveStyle: 'balanced',
        customInstructions: '',
      },
    },
    sync: { url: '', token: '' },
  },
  state: {
    revision: 0,
    moduleRevs: {},
  },
  modules: {
    todos: [],
    notes: [],
    agent: {
      activeId: 'default',
      conversations: [{
        id: 'default',
        title: '新对话',
        messages: [],
        createdAt: '',
        updatedAt: '',
      }],
    },
    agentRuns: [],
    agentSuggestions: [],
    agentMessages: [],
    agentGoals: [],
    agentGoalActions: [],
    agentMemories: [],
    agentSkills: [],
    // 仅记录收件箱 UID 游标，不保存邮件正文；用于避免重启后重复分析、重复提醒同一封邮件。
    agentMailWatch: null,
    notificationHistory: [],
    // 只保存不可逆操作的状态、指纹和最小回执，不保存邮件正文、授权码或音乐 Cookie。
    // 用于在 IPC/网络结果丢失后阻止同一个操作被静默重放。
    externalOperations: [],
    profileItems: [],
    categories: [],
    music: {
      account: null,
      playlists: [],
      tracksByPlaylist: {},
      selectedPlaylistId: null,
      syncedAt: null,
    },
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDeep(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch === undefined ? base : patch;
  }
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      out[key] = mergeDeep(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function init(userDataDir) {
  dataFile = path.join(userDataDir, 'workbench-data.json');
  backupDir = path.join(userDataDir, 'backups');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  if (!fs.existsSync(dataFile)) {
    writeData(clone(DEFAULT_DATA));
  }
}

function safeDataCopy(data) {
  const safe = clone(data);
  if (safe.settings?.email) safe.settings.email.pass = '';
  if (safe.settings?.agent) safe.settings.agent.apiKey = '';
  if (safe.settings?.sync) safe.settings.sync.token = '';
  return safe;
}

function backupFiles() {
  if (!backupDir || !fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((file) => /^(?:auto|manual|pre-restore)-\d+\.json$/.test(file))
    .map((file) => {
      const fullPath = path.join(backupDir, file);
      const stat = fs.statSync(fullPath);
      const reason = file.split('-')[0] === 'pre' ? 'pre-restore' : file.split('-')[0];
      return { id: file, reason, createdAt: stat.mtime.toISOString(), size: stat.size, fullPath };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function pruneBackups() {
  const automatic = backupFiles().filter((item) => item.reason === 'auto');
  const keep = new Set(automatic.slice(0, MAX_RECENT_AUTOMATIC_BACKUPS).map((item) => item.id));
  const earliestDay = new Date();
  earliestDay.setDate(earliestDay.getDate() - DAILY_BACKUP_RETENTION_DAYS);
  const retainedDays = new Set();
  for (const item of automatic) {
    const date = new Date(item.createdAt);
    if (date < earliestDay) continue;
    const dayKey = date.toISOString().slice(0, 10);
    if (!retainedDays.has(dayKey)) {
      retainedDays.add(dayKey);
      keep.add(item.id);
    }
  }
  for (const item of automatic) {
    if (!keep.has(item.id)) fs.rmSync(item.fullPath, { force: true });
  }
}

function writeBackup(data, reason = 'manual') {
  if (!backupDir) throw new Error('数据存储尚未初始化');
  const allowedReason = ['auto', 'manual', 'pre-restore'].includes(reason) ? reason : 'manual';
  const file = `${allowedReason}-${Date.now()}.json`;
  fs.writeFileSync(path.join(backupDir, file), JSON.stringify(safeDataCopy(data), null, 2), 'utf8');
  pruneBackups();
  return backupFiles().find((item) => item.id === file) || null;
}

function maybeWriteAutomaticBackup(data) {
  const now = Date.now();
  // ponytail: 高频输入会在短时间内合并为一份恢复点；若未来出现多窗口并发编辑，再改为事务日志或版本数据库。
  if (now - lastAutomaticBackupAt < AUTOMATIC_BACKUP_INTERVAL_MS) return;
  writeBackup(data, 'auto');
  lastAutomaticBackupAt = now;
}

function readData() {
  if (!dataFile || !fs.existsSync(dataFile)) {
    return clone(DEFAULT_DATA);
  }
  try {
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return normalizeData(mergeDeep(clone(DEFAULT_DATA), saved));
  } catch {
    return clone(DEFAULT_DATA);
  }
}

/** 将旧版唯一聊天记录迁移到会话集合，保留用户已有的 Agent 历史。 */
function normalizeAgentModule(data) {
  const agentModule = data.modules?.agent;
  if (Array.isArray(agentModule)) {
    const hasHistory = agentModule.length > 0;
    data.modules.agent = {
      activeId: hasHistory ? 'legacy' : 'default',
      conversations: [{
        id: hasHistory ? 'legacy' : 'default',
        title: hasHistory ? '此前对话' : '新对话',
        messages: agentModule,
        createdAt: '',
        updatedAt: '',
      }],
    };
  }
  return data;
}

/** 保留旧版“工作偏好”，并把它们以已审核记忆的形式暴露给新的记忆系统。 */
function normalizeData(data) {
  data.schemaVersion = Math.max(Number(data.schemaVersion) || 0, DEFAULT_DATA.schemaVersion);
  normalizeAgentModule(data);
  const preferences = Array.isArray(data.settings?.profile?.preferences) ? data.settings.profile.preferences : [];
  const memories = Array.isArray(data.modules?.agentMemories) ? data.modules.agentMemories : [];
  const known = new Set(memories.map((memory) => `${memory.kind}:${memory.content}`));
  for (const preference of preferences) {
    const content = String(preference || '').replace(/\s+/g, ' ').trim();
    if (!content || known.has(`preference:${content}`)) continue;
    const id = `legacy-preference-${crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)}`;
    memories.push({
      id,
      content,
      kind: 'preference',
      status: 'active',
      source: 'legacy-profile',
      replacesId: null,
      replacedById: null,
      createdAt: '',
      updatedAt: '',
      reviewedAt: '',
    });
    known.add(`preference:${content}`);
  }
  data.modules.agentMemories = memories;
  return data;
}

function writeData(data) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const tmpFile = `${dataFile}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpFile, dataFile);
}

function getData() {
  return readData();
}

function updateData(mutator) {
  const current = readData();
  const next = mutator(current) || current;
  maybeWriteAutomaticBackup(current);
  writeData(next);
  return readData();
}

function listBackups() {
  return backupFiles().map(({ fullPath: _fullPath, ...item }) => item);
}

function createBackup() {
  return writeBackup(readData(), 'manual');
}

function restoreBackup(id) {
  const target = backupFiles().find((item) => item.id === String(id || ''));
  if (!target) throw new Error('找不到所选备份');
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(target.fullPath, 'utf8'));
  } catch {
    throw new Error('备份文件无法读取');
  }
  if (!saved || typeof saved !== 'object' || !saved.settings || !saved.modules) {
    throw new Error('备份文件格式无效');
  }
  const current = readData();
  writeBackup(current, 'pre-restore');
  const restored = normalizeData(mergeDeep(clone(DEFAULT_DATA), saved));
  // 备份与导出不携带密钥；恢复历史内容时也不意外覆盖当前设备上的敏感连接配置。
  restored.settings.email.pass = current.settings.email.pass;
  restored.settings.agent.apiKey = current.settings.agent.apiKey;
  restored.settings.sync.token = current.settings.sync.token;
  writeData(restored);
  return { restoredAt: new Date().toISOString(), backup: listBackups().find((item) => item.id === target.id) || null };
}

function exportSafeData() {
  return safeDataCopy(readData());
}

function newId() {
  return crypto.randomUUID();
}

function getSettings() {
  return readData().settings;
}

function normaliseAvatarDataUrl(value) {
  const avatarDataUrl = String(value || '');
  const avatarMatch = avatarDataUrl.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!avatarMatch) return '';
  const bytes = Buffer.from(avatarMatch[2], 'base64');
  if (!bytes.length || bytes.length > MAX_AVATAR_FILE_SIZE) return '';
  const isJpeg = avatarMatch[1] === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = avatarMatch[1] === 'png'
    && bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return isJpeg || isPng ? avatarDataUrl : '';
}

function setSettings(patch) {
  return updateData((data) => {
    data.settings = mergeDeep(data.settings, patch);
    data.settings.profile.avatarDataUrl = normaliseAvatarDataUrl(data.settings?.profile?.avatarDataUrl);
  }).settings;
}

function getModule(name) {
  return readData().modules[name] || [];
}

function setModule(name, items) {
  return updateData((data) => {
    data.modules[name] = items;
  }).modules[name];
}

function updateModule(name, mutator) {
  return updateData((data) => {
    data.modules[name] = mutator(data.modules[name] || []);
  }).modules[name];
}

module.exports = {
  init,
  getData,
  updateData,
  newId,
  getSettings,
  setSettings,
  getModule,
  setModule,
  updateModule,
  listBackups,
  createBackup,
  restoreBackup,
  exportSafeData,
};

if (process.env.WORKBENCH_STORE_SELF_TEST === '1') {
  const assert = require('node:assert/strict');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-store-self-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'workbench-data.json'), JSON.stringify({
      modules: { agent: [{ role: 'user', content: '保留这条旧消息' }] },
      settings: { profile: { preferences: ['旧版工作偏好'] } },
    }), 'utf8');
    init(dir);
    const migrated = getModule('agent');
    assert.equal(migrated.conversations.length, 1);
    assert.equal(migrated.conversations[0].title, '此前对话');
    assert.equal(migrated.conversations[0].messages[0].content, '保留这条旧消息');
    assert.equal(getSettings().agent.proactiveEnabled, true);
    assert.equal(getSettings().agent.emailMonitorEnabled, false);
    assert.deepEqual(getSettings().agent.persona, {
      name: 'Agent',
      personality: 'calm',
      proactiveStyle: 'balanced',
      customInstructions: '',
    });
    assert.equal(setSettings({ profile: { avatarDataUrl: 'data:image/png;base64,iVBORw0KGgo=' } }).profile.avatarDataUrl, 'data:image/png;base64,iVBORw0KGgo=');
    assert.equal(setSettings({ profile: { avatarDataUrl: 'data:image/gif;base64,AA==' } }).profile.avatarDataUrl, '');
    assert.equal(setSettings({ profile: { avatarDataUrl: 'data:image/png;base64,AA==' } }).profile.avatarDataUrl, '');
    assert.equal(getModule('agentMemories').find((memory) => memory.content === '旧版工作偏好')?.status, 'active');
    setSettings({ agent: { apiKey: 'store-self-test-secret' } });
    const backup = createBackup();
    assert.ok(backup?.id);
    const backupText = fs.readFileSync(path.join(dir, 'backups', backup.id), 'utf8');
    assert.ok(!backupText.includes('store-self-test-secret'));
    setModule('notes', [{ id: 'after-backup', title: '恢复前的变化', content: '', updatedAt: '' }]);
    const restored = restoreBackup(backup.id);
    assert.ok(restored.restoredAt);
    assert.equal(getModule('notes').length, 0);
    assert.equal(getSettings().agent.apiKey, 'store-self-test-secret');
    console.log('store self-test ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
