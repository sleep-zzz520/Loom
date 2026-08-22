const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let dataFile = '';

const DEFAULT_DATA = {
  schemaVersion: 1,
  settings: {
    profile: {
      name: '',
      nickname: '',
      role: '',
      about: '',
      currentFocus: '',
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
    agent: { apiBase: '', apiKey: '', model: '' },
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
    notificationHistory: [],
    profileItems: [],
    categories: [],
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
    return normalizeAgentModule(mergeDeep(clone(DEFAULT_DATA), saved));
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

function setSettings(patch) {
  return updateData((data) => {
    data.settings = mergeDeep(data.settings, patch);
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
    }), 'utf8');
    init(dir);
    const migrated = getModule('agent');
    assert.equal(migrated.conversations.length, 1);
    assert.equal(migrated.conversations[0].title, '此前对话');
    assert.equal(migrated.conversations[0].messages[0].content, '保留这条旧消息');
    console.log('store self-test ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
