const { contextBridge, ipcRenderer } = require('electron');

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
    updateSuggestion: (id, patch) => ipcRenderer.invoke('agent:update-suggestion', id, patch),
    checkProactive: (force = false) => ipcRenderer.invoke('agent:check-proactive', force),
    onProactiveUpdated: (callback) => {
      const listener = () => callback?.();
      ipcRenderer.on('agent:proactive-updated', listener);
      return () => ipcRenderer.removeListener('agent:proactive-updated', listener);
    },
    onOpenAgent: (callback) => {
      const listener = () => callback?.();
      ipcRenderer.on('agent:open', listener);
      return () => ipcRenderer.removeListener('agent:open', listener);
    },
  },
  notify: {
    checkTodos: () => ipcRenderer.invoke('notify:check-todos'),
    sendNtfy: (title, message) => ipcRenderer.invoke('notify:send-ntfy', title, message),
  },
});
