const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let dataFile = '';
const MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024;

const DEFAULT_DATA = {
  schemaVersion: 5,
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
      // 邮件正文可能包含私人信息；只有用户在设置中明确开启后，才允许发送候选邮件摘要给 Agent 模型判断。
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
  fs.mkdirSync(userDataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) {
    writeData(clone(DEFAULT_DATA));
  }
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
  writeData(next);
  return readData();
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
    console.log('store self-test ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
