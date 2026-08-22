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
  repeatUntil: string | null;
  color: string | null;
  personalDateId: string | null;
  recurrenceId: string | null;
  occurrenceSourceId?: string;
  createdAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

export interface ImportantDate {
  id: string;
  title: string;
  date: string;
}

export interface NotificationHistoryItem {
  id: string;
  eventKey: string;
  title: string;
  body: string;
  sentAt: string;
}

export type LibrarySource = 'imported' | 'created';

export interface ProfileItem {
  id: string;
  name: string;
  source: LibrarySource;
  categoryId: string;
  storageName: string;
  mimeType: string;
  size: number;
  content: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface AppSettings {
  profile: {
    name: string;
    nickname: string;
    role: string;
    about: string;
    currentFocus: string;
    responseLength: 'concise' | 'balanced' | 'detailed';
    confirmationMode: 'mutations-only' | 'always-explain';
    preferences: string[];
  };
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
  notify: {
    ntfyUrl: string;
    ntfyTopic: string;
    barkUrl: string;
    channel: 'ntfy' | 'bark' | 'none';
    reminderMinutes: number[];
    quietHours: { start: string; end: string };
    maxDailyNotifications: number;
    importantDates: ImportantDate[];
  };
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
    agent: AgentConversationStore;
    agentRuns: AgentRun[];
    agentSuggestions: AgentSuggestion[];
    notificationHistory: NotificationHistoryItem[];
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
  attachments?: ChatAttachment[];
}

export interface ChatAttachment {
  id: string;
  name: string;
  content: string;
}

export interface AgentConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentConversationStore {
  activeId: string;
  conversations: AgentConversation[];
}

export type AgentTrigger = 'daily-briefing' | 'event-follow-up';
export type AgentRunStatus = 'running' | 'completed' | 'failed';
export type AgentSuggestionStatus = 'unread' | 'read' | 'dismissed' | 'acted';

export interface AgentSuggestionReference {
  type: 'todo' | 'schedule' | 'note' | 'library';
  id: string;
  label: string;
}

export interface AgentSuggestion {
  id: string;
  dedupeKey: string;
  trigger: AgentTrigger;
  title: string;
  summary: string;
  reason: string;
  references: AgentSuggestionReference[];
  proposal?: AgentProposal | null;
  status: AgentSuggestionStatus;
  createdAt: string;
  updatedAt: string;
  notifiedAt: string | null;
}

export interface AgentRun {
  id: string;
  trigger: AgentTrigger;
  dateKey: string;
  sourceKey?: string;
  status: AgentRunStatus;
  startedAt: string;
  finishedAt: string | null;
  suggestionId: string | null;
  error?: string;
}

export type AgentProposal =
  | { kind: 'create_todo'; title: string; priority: Priority; due: string | null }
  | { kind: 'create_note'; title: string; content: string }
  | { kind: 'save_important_date'; title: string; date: string };

export interface AgentReply {
  content: string;
  proposal?: AgentProposal;
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
  library: {
    importFile: (categoryId?: string) => Promise<{ items: ProfileItem[]; item: ProfileItem } | null>;
    createDocument: (categoryId?: string) => Promise<{ items: ProfileItem[]; item: ProfileItem }>;
    updateItem: (id: string, patch: Partial<Pick<ProfileItem, 'name' | 'content' | 'categoryId' | 'note'>>) => Promise<{ items: ProfileItem[]; item: ProfileItem }>;
    removeItem: (id: string) => Promise<ProfileItem[]>;
    previewFile: (id: string) => Promise<{ available: boolean; reason?: string; mimeType?: string; data?: string }>;
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
        repeatUntil?: string | null;
      }) => Promise<Todo[]>;
      update: (id: string, patch: Partial<Todo>) => Promise<Todo[]>;
      remove: (id: string) => Promise<Todo[]>;
      rememberPersonalDate: (id: string) => Promise<{ todos: Todo[]; personalDate: ImportantDate }>;
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
    status: () => Promise<boolean>;
    chat: (messages: ChatMessage[], onDelta?: (delta: string) => void) => Promise<AgentReply>;
    confirmProposal: (proposal: AgentProposal) => Promise<{ content: string }>;
    getSuggestions: () => Promise<AgentSuggestion[]>;
    updateSuggestion: (id: string, patch: { status: AgentSuggestionStatus }) => Promise<AgentSuggestion[]>;
    checkProactive: (force?: boolean) => Promise<AgentSuggestion[]>;
    onProactiveUpdated: (callback: () => void) => () => void;
    onOpenAgent: (callback: () => void) => () => void;
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
