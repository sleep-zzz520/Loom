const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let dataFile = '';

const DEFAULT_DATA = {
  schemaVersion: 1,
  settings: {
    profile: { name: '', about: '', preferences: [] },
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
    notify: { ntfyUrl: 'https://ntfy.sh', ntfyTopic: '', barkUrl: '', channel: 'ntfy' },
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
    return mergeDeep(clone(DEFAULT_DATA), saved);
  } catch {
    return clone(DEFAULT_DATA);
  }
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
