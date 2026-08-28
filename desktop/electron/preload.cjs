const { contextBridge, ipcRenderer } = require('electron');

const agentOpenListeners = new Set();
let pendingAgentOpen = null;
const proactiveAlertListeners = new Set();
let pendingProactiveAlert = null;

ipcRenderer.on('agent:open', (_event, messageId) => {
  const nextMessageId = messageId || undefined;
  if (agentOpenListeners.size === 0) {
    pendingAgentOpen = { messageId: nextMessageId };
    return;
  }
  agentOpenListeners.forEach((callback) => callback(nextMessageId));
});

ipcRenderer.on('agent:proactive-alert', (_event, alert) => {
  if (!alert?.messageId) return;
  if (proactiveAlertListeners.size === 0) {
    pendingProactiveAlert = alert;
    return;
  }
  proactiveAlertListeners.forEach((callback) => callback(alert));
});

async function invokeMusic(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    const message = String(error?.message || error).replace(/^Error invoking remote method 'music:[^']+': Error: /, '');
    throw new Error(message);
  }
}

contextBridge.exposeInMainWorld('workbench', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  data: {
    getAll: () => ipcRenderer.invoke('data:get'),
    getSettings: () => ipcRenderer.invoke('data:get-settings'),
    setSettings: (patch) => ipcRenderer.invoke('data:set-settings', patch),
    getModule: (name) => ipcRenderer.invoke('data:get-module', name),
    setModule: (name, items) => ipcRenderer.invoke('data:set-module', name, items),
  },
  library: {
    importFile: (categoryId = '') => ipcRenderer.invoke('library:import-file', categoryId),
    createDocument: (categoryId = '') => ipcRenderer.invoke('library:create-document', categoryId),
    updateItem: (id, patch) => ipcRenderer.invoke('library:update-item', id, patch),
    removeItem: (id) => ipcRenderer.invoke('library:remove-item', id),
    previewFile: (id) => ipcRenderer.invoke('library:preview-file', id),
  },
  workspace: {
    snapshot: () => ipcRenderer.invoke('workspace:snapshot'),
    todos: {
      list: () => ipcRenderer.invoke('workspace:list-todos'),
      create: (input) => ipcRenderer.invoke('workspace:create-todo', input),
      update: (id, patch) => ipcRenderer.invoke('workspace:update-todo', id, patch),
      remove: (id) => ipcRenderer.invoke('workspace:remove-todo', id),
      rememberPersonalDate: (id) => ipcRenderer.invoke('workspace:remember-personal-date', id),
    },
    notes: {
      list: () => ipcRenderer.invoke('workspace:list-notes'),
      save: (input) => ipcRenderer.invoke('workspace:save-note', input),
      remove: (id) => ipcRenderer.invoke('workspace:remove-note', id),
    },
  },
  calendar: {
    getHolidays: (year) => ipcRenderer.invoke('calendar:get-holidays', year),
  },
  music: {
    serviceStatus: () => invokeMusic('music:service-status'),
    search: (query) => invokeMusic('music:search', query),
    hotSearch: () => invokeMusic('music:hot-search'),
    trackDetails: (id) => invokeMusic('music:track-details', id),
    lyrics: (id) => invokeMusic('music:lyrics', id),
    playbackUrl: (id) => invokeMusic('music:playback-url', id),
    accountState: () => invokeMusic('music:account-state'),
    startQrLogin: () => invokeMusic('music:qr-start'),
    checkQrLogin: (key) => invokeMusic('music:qr-check', key),
    syncAccount: () => invokeMusic('music:sync-account'),
    syncPlaylist: (id) => invokeMusic('music:sync-playlist', id),
    addToPlaylist: (playlistId, trackId) => invokeMusic('music:add-to-playlist', playlistId, trackId),
    removeFromPlaylist: (playlistId, trackId) => invokeMusic('music:remove-from-playlist', playlistId, trackId),
    logout: () => invokeMusic('music:logout'),
  },
  mail: {
    account: () => ipcRenderer.invoke('mail:account'),
    saveAccount: (input) => ipcRenderer.invoke('mail:save-account', input),
    verify: (input) => ipcRenderer.invoke('mail:verify', input),
    list: (folder, limit) => ipcRenderer.invoke('mail:list', folder, limit),
    getMessage: (folder, uid) => ipcRenderer.invoke('mail:get-message', folder, uid),
    markRead: (folder, uid) => ipcRenderer.invoke('mail:mark-read', folder, uid),
    send: (input) => ipcRenderer.invoke('mail:send', input),
  },
  agent: {
    status: () => ipcRenderer.invoke('agent:status'),
    chat: (messages, onDelta) => {
      const listener = (_event, delta) => onDelta?.(delta);
      ipcRenderer.on('agent:stream', listener);
      return ipcRenderer.invoke('agent:chat', messages).finally(() => {
        ipcRenderer.removeListener('agent:stream', listener);
      });
    },
    confirmProposal: (proposal) => ipcRenderer.invoke('agent:confirm-proposal', proposal),
    getSuggestions: () => ipcRenderer.invoke('agent:get-suggestions'),
    getSuggestionHistory: () => ipcRenderer.invoke('agent:get-suggestion-history'),
    getMessages: () => ipcRenderer.invoke('agent:get-messages'),
    markMessageRead: (id, conversationId) => ipcRenderer.invoke('agent:mark-message-read', id, conversationId),
    updateSuggestion: (id, patch) => ipcRenderer.invoke('agent:update-suggestion', id, patch),
    linkSuggestionToGoal: (id, goalId) => ipcRenderer.invoke('agent:link-suggestion-goal', id, goalId),
    checkProactive: (force = false) => ipcRenderer.invoke('agent:check-proactive', force),
    getGoals: (includeArchived = false) => ipcRenderer.invoke('agent:get-goals', includeArchived),
    createGoal: (input) => ipcRenderer.invoke('agent:create-goal', input),
    updateGoal: (id, patch) => ipcRenderer.invoke('agent:update-goal', id, patch),
    addGoalAction: (input) => ipcRenderer.invoke('agent:add-goal-action', input),
    updateGoalAction: (id, patch) => ipcRenderer.invoke('agent:update-goal-action', id, patch),
    getMemories: (includeArchived = false) => ipcRenderer.invoke('agent:get-memories', includeArchived),
    reviewMemory: (id, decision) => ipcRenderer.invoke('agent:review-memory', id, decision),
    getSkills: (includeArchived = false) => ipcRenderer.invoke('agent:get-skills', includeArchived),
    reviewSkill: (id, decision) => ipcRenderer.invoke('agent:review-skill', id, decision),
    onProactiveUpdated: (callback) => {
      const listener = () => callback?.();
      ipcRenderer.on('agent:proactive-updated', listener);
      return () => ipcRenderer.removeListener('agent:proactive-updated', listener);
    },
    onProactiveAlert: (callback) => {
      if (typeof callback !== 'function') return () => {};
      proactiveAlertListeners.add(callback);
      if (pendingProactiveAlert) {
        const alert = pendingProactiveAlert;
        pendingProactiveAlert = null;
        queueMicrotask(() => callback(alert));
      }
      return () => proactiveAlertListeners.delete(callback);
    },
    onStateUpdated: (callback) => {
      const listener = () => callback?.();
      ipcRenderer.on('agent:state-updated', listener);
      return () => ipcRenderer.removeListener('agent:state-updated', listener);
    },
    onOpenAgent: (callback) => {
      if (typeof callback !== 'function') return () => {};
      agentOpenListeners.add(callback);
      if (pendingAgentOpen) {
        const { messageId } = pendingAgentOpen;
        pendingAgentOpen = null;
        queueMicrotask(() => callback(messageId));
      }
      return () => agentOpenListeners.delete(callback);
    },
    onMusicCommand: (callback) => {
      const listener = (_event, command) => callback?.(command);
      ipcRenderer.on('agent:music-command', listener);
      return () => ipcRenderer.removeListener('agent:music-command', listener);
    },
  },
  notify: {
    checkTodos: () => ipcRenderer.invoke('notify:check-todos'),
    sendNtfy: (title, message) => ipcRenderer.invoke('notify:send-ntfy', title, message),
  },
});
