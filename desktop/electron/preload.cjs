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
    importFile: () => ipcRenderer.invoke('library:import-file'),
    createDocument: () => ipcRenderer.invoke('library:create-document'),
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
    chat: (messages) => ipcRenderer.invoke('agent:chat', messages),
  },
  notify: {
    checkTodos: () => ipcRenderer.invoke('notify:check-todos'),
    sendNtfy: (title, message) => ipcRenderer.invoke('notify:send-ntfy', title, message),
  },
});
