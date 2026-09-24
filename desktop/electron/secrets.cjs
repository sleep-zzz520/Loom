const SECRET_PREFIX = 'safe-storage:v1:';
const security = require('./security.cjs');

let secureStorage = null;

function init({ safeStorage } = {}) {
  secureStorage = safeStorage || null;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX);
}

function canEncrypt() {
  return Boolean(secureStorage && typeof secureStorage.isEncryptionAvailable === 'function' && secureStorage.isEncryptionAvailable());
}

function encrypt(value, label = '密钥') {
  const text = String(value || '');
  if (!text || isEncrypted(text)) return text;
  if (!canEncrypt()) throw new Error(`系统安全存储不可用，无法安全保存${label}`);
  return `${SECRET_PREFIX}${secureStorage.encryptString(text).toString('base64')}`;
}

function decrypt(value, label = '密钥') {
  const text = String(value || '');
  if (!text || !isEncrypted(text)) return text;
  if (!canEncrypt()) throw new Error(`系统安全存储不可用，无法读取${label}`);
  try {
    return secureStorage.decryptString(Buffer.from(text.slice(SECRET_PREFIX.length), 'base64'));
  } catch {
    throw new Error(`${label}无法解密，请在设置中重新输入`);
  }
}

function protectAgentApiKeyPatch(patch, { currentAgent = null, currentApiBase = '' } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  if (Array.isArray(patch.agent?.modelProfiles)) {
    const currentProfilesById = new Map((currentAgent?.modelProfiles || []).map((profile) => [profile.id, profile]));
    return {
      ...patch,
      agent: {
        ...patch.agent,
        modelProfiles: patch.agent.modelProfiles.map((profile) => {
          if (!profile || typeof profile !== 'object') return profile;
          const currentProfile = currentProfilesById.get(profile.id);
          const submittedKey = typeof profile.apiKey === 'string' ? profile.apiKey : '';
          if (submittedKey.trim()) return { ...profile, apiKey: encrypt(submittedKey, 'Agent API 密钥') };
          if (currentProfile && !security.hasServiceOriginChanged(currentProfile.apiBase, profile.apiBase)) {
            return { ...profile, apiKey: currentProfile.apiKey || '' };
          }
          return { ...profile, apiKey: '' };
        }),
      },
    };
  }
  const apiKey = patch.agent?.apiKey;
  const hasNewKey = typeof apiKey === 'string' && Boolean(apiKey.trim());
  const endpointChanged = Boolean(
    patch.agent
      && Object.hasOwn(patch.agent, 'apiBase')
      && security.hasServiceOriginChanged(currentApiBase, patch.agent.apiBase)
  );
  if (endpointChanged && !hasNewKey) {
    return { ...patch, agent: { ...patch.agent, apiKey: '' } };
  }
  if (!hasNewKey) return patch;
  return {
    ...patch,
    agent: {
      ...patch.agent,
      apiKey: encrypt(apiKey, 'Agent API 密钥'),
    },
  };
}

function protectGithubTokenPatch(patch) {
  if (!patch?.github || typeof patch.github !== 'object') return patch;
  const token = patch.github.token;
  if (typeof token !== 'string' || !token.trim()) return patch;
  return { ...patch, github: { ...patch.github, token: encrypt(token.trim(), 'GitHub 访问令牌') } };
}

function withDecryptedGithubToken(settings) {
  return {
    ...settings,
    github: {
      ...settings.github,
      token: decryptForRuntime(settings.github?.token, 'GitHub 访问令牌'),
    },
  };
}

function withDecryptedAgentApiKey(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const profiles = Array.isArray(settings.agent?.modelProfiles) ? settings.agent.modelProfiles : [];
  if (profiles.length) {
    const decryptedProfiles = profiles.map((profile) => ({
      ...profile,
      apiKey: decryptForRuntime(profile.apiKey),
    }));
    const defaultProfile = decryptedProfiles.find((profile) => profile.id === settings.agent.defaultModelProfileId)
      || decryptedProfiles[0];
    return {
      ...settings,
      agent: {
        ...settings.agent,
        modelProfiles: decryptedProfiles,
        defaultModelProfileId: defaultProfile.id,
        apiBase: defaultProfile.apiBase,
        apiKey: defaultProfile.apiKey,
        model: defaultProfile.model,
      },
    };
  }
  const storedKey = settings.agent?.apiKey;
  return {
    ...settings,
    agent: {
      ...settings.agent,
      // 旧版明文会在启动时迁移；系统安全存储不可用时不再使用它。
      apiKey: decryptForRuntime(storedKey),
    },
  };
}

function decryptForRuntime(storedKey, label = 'Agent API 密钥') {
  return storedKey && !isEncrypted(storedKey) && !canEncrypt()
    ? ''
    : decrypt(storedKey, label);
}

function migrateGithubToken(store) {
  const token = store.getSettings().github?.token;
  if (!canEncrypt() || !token || isEncrypted(token)) return false;
  store.setSettings({ github: { token: encrypt(token, 'GitHub 访问令牌') } });
  return true;
}

function migrateAgentApiKey(store) {
  const agent = store.getSettings().agent || {};
  if (!canEncrypt()) return false;
  if (Array.isArray(agent.modelProfiles) && agent.modelProfiles.length) {
    let changed = false;
    const modelProfiles = agent.modelProfiles.map((profile) => {
      if (!profile.apiKey || isEncrypted(profile.apiKey)) return profile;
      changed = true;
      return { ...profile, apiKey: encrypt(profile.apiKey, 'Agent API 密钥') };
    });
    if (changed) store.setSettings({ agent: { modelProfiles } });
    return changed;
  }
  if (!agent.apiKey || isEncrypted(agent.apiKey)) return false;
  store.setSettings({ agent: { apiKey: encrypt(agent.apiKey, 'Agent API 密钥') } });
  return true;
}

module.exports = {
  SECRET_PREFIX,
  init,
  isEncrypted,
  canEncrypt,
  encrypt,
  decrypt,
  protectAgentApiKeyPatch,
  protectGithubTokenPatch,
  withDecryptedAgentApiKey,
  withDecryptedGithubToken,
  migrateAgentApiKey,
  migrateGithubToken,
};

if (process.env.WORKBENCH_SECRETS_SELF_TEST === '1') {
  const assert = require('node:assert/strict');
  init({
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
    },
  });
  try {
    const encrypted = encrypt('agent-test-secret', 'Agent API 密钥');
    assert.match(encrypted, /^safe-storage:v1:/);
    assert.ok(!encrypted.includes('agent-test-secret'));
    assert.equal(decrypt(encrypted, 'Agent API 密钥'), 'agent-test-secret');
    const protectedPatch = protectAgentApiKeyPatch({ agent: { apiBase: 'https://api.example.com', apiKey: 'agent-test-secret' } });
    assert.match(protectedPatch.agent.apiKey, /^safe-storage:v1:/);
    assert.equal(withDecryptedAgentApiKey({ agent: protectedPatch.agent }).agent.apiKey, 'agent-test-secret');
    assert.equal(protectAgentApiKeyPatch({ agent: { apiKey: '' } }).agent.apiKey, '');
    const clearedOnEndpointChange = protectAgentApiKeyPatch(
      { agent: { apiBase: 'https://attacker.example/v1' } },
      { currentApiBase: 'https://api.example.com/v1' },
    );
    assert.equal(clearedOnEndpointChange.agent.apiKey, '');
    const protectedProfiles = protectAgentApiKeyPatch({ agent: { modelProfiles: [{
      id: 'glm', name: 'GLM', apiBase: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'glm-secret', model: 'glm-4.5-air',
    }, {
      id: 'deepseek', name: 'DeepSeek', apiBase: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat',
    }] } }, { currentAgent: { modelProfiles: [{
      id: 'deepseek', name: 'DeepSeek', apiBase: 'https://api.deepseek.com/v1', apiKey: encrypted, model: 'deepseek-chat',
    }] } });
    assert.match(protectedProfiles.agent.modelProfiles[0].apiKey, /^safe-storage:v1:/);
    assert.equal(protectedProfiles.agent.modelProfiles[1].apiKey, encrypted);
    const decryptedProfiles = withDecryptedAgentApiKey({ agent: {
      modelProfiles: protectedProfiles.agent.modelProfiles,
      defaultModelProfileId: 'deepseek',
    } });
    assert.equal(decryptedProfiles.agent.apiKey, 'agent-test-secret');
    assert.equal(decryptedProfiles.agent.model, 'deepseek-chat');
    const profileKeyClearedOnEndpointChange = protectAgentApiKeyPatch({ agent: { modelProfiles: [{
      id: 'deepseek', name: 'DeepSeek', apiBase: 'https://attacker.example/v1', model: 'deepseek-chat',
    }] } }, { currentAgent: { modelProfiles: [{
      id: 'deepseek', name: 'DeepSeek', apiBase: 'https://api.deepseek.com/v1', apiKey: encrypted, model: 'deepseek-chat',
    }] } });
    assert.equal(profileKeyClearedOnEndpointChange.agent.modelProfiles[0].apiKey, '');
    const protectedGithub = protectGithubTokenPatch({ github: { enabled: true, token: 'github-test-secret' } });
    assert.match(protectedGithub.github.token, /^safe-storage:v1:/);
    assert.equal(withDecryptedGithubToken({ github: protectedGithub.github }).github.token, 'github-test-secret');
    console.log('secrets self-test ok');
  } finally {
    init();
  }
}
