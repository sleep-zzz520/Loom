export type Priority = 'high' | 'medium' | 'low';

export interface Todo {
  id: string;
  title: string;
  priority: Priority;
  start: string | null;
  end: string | null;
  due: string | null;
  done: boolean;
  repeat: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  color: string | null;
  createdAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

export type Privacy = 'public' | 'private' | 'secret';

export interface ProfileItem {
  id: string;
  name: string;
  categoryId: string;
  privacy: Privacy;
  path: string;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  privacy: Privacy;
}

export interface AppSettings {
  profile: { name: string; about: string; preferences: string[] };
  email: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
  };
  netease: { apiBase: string };
  notify: { ntfyUrl: string; ntfyTopic: string; barkUrl: string; channel: 'ntfy' | 'bark' | 'none' };
  agent: { apiBase: string; apiKey: string; model: string };
  sync: { url: string; token: string };
}

export interface WorkbenchData {
  schemaVersion: number;
  settings: AppSettings;
  state: { revision: number; moduleRevs: Record<string, number> };
  modules: {
    todos: Todo[];
    notes: Note[];
    profileItems: ProfileItem[];
    categories: Category[];
  };
}

export interface WorkspaceSnapshot {
  todos: Todo[];
  notes: Note[];
  categories: Category[];
  profileItems: ProfileItem[];
  settings: AppSettings;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface WorkbenchApi {
  appInfo: () => Promise<{ name: string; version: string; platform: string }>;
  data: {
    getAll: () => Promise<WorkbenchData>;
    getSettings: () => Promise<AppSettings>;
    setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
    getModule: <K extends keyof WorkbenchData['modules']>(
      name: K
    ) => Promise<WorkbenchData['modules'][K]>;
    setModule: <K extends keyof WorkbenchData['modules']>(
      name: K,
      items: WorkbenchData['modules'][K]
    ) => Promise<WorkbenchData['modules'][K]>;
  };
  workspace: {
    snapshot: () => Promise<WorkspaceSnapshot>;
    todos: {
      list: () => Promise<Todo[]>;
      create: (input: {
        title: string;
        priority?: Priority;
        due?: string | null;
        start?: string | null;
        end?: string | null;
        color?: string | null;
        repeat?: Todo['repeat'];
      }) => Promise<Todo[]>;
      update: (id: string, patch: Partial<Todo>) => Promise<Todo[]>;
      remove: (id: string) => Promise<Todo[]>;
    };
    notes: {
      list: () => Promise<Note[]>;
      save: (input: { id?: string; title?: string; content?: string }) => Promise<Note[]>;
      remove: (id: string) => Promise<Note[]>;
    };
  };
  calendar: {
    getHolidays: (year: number) => Promise<Record<string, { name: string; isOffDay: boolean }>>;
  };
  agent: {
    chat: (messages: ChatMessage[]) => Promise<string>;
  };
  notify: {
    checkTodos: () => Promise<void>;
    sendNtfy: (title: string, message: string) => Promise<void>;
  };
}

declare global {
  interface Window {
    workbench: WorkbenchApi;
  }
}
