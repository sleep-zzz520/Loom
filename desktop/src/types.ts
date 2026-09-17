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
  agentGoalId?: string | null;
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

export interface MusicTrack {
  id: number;
  title: string;
  artists: string;
  album: string;
  coverUrl: string | null;
  durationMs: number | null;
}

export interface MusicLyricLine {
  atMs: number;
  text: string;
}

export interface MusicAccount {
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  signature: string;
  level: number | null;
  vipType: number | null;
  loggedInAt?: string;
  syncedAt?: string;
}

export interface MusicPlaylist {
  id: number;
  name: string;
  coverUrl: string | null;
  trackCount: number;
  creatorName: string;
  creatorId: number | null;
  isMine: boolean;
  subscribed: boolean;
}

export interface MusicLibrary {
  account: MusicAccount | null;
  playlists: MusicPlaylist[];
  tracksByPlaylist: Record<string, MusicTrack[]>;
  selectedPlaylistId: number | null;
  syncedAt: string | null;
}

export interface MusicPlaylistMutationResult {
  playlist: MusicPlaylist;
  tracks: MusicTrack[];
  library: MusicLibrary;
}

export interface MusicServiceStatus {
  ready: boolean;
  embedded: boolean;
  base: string;
  error: string;
}

export type AgentMusicCommand =
  | { type: 'show-results'; query: string; tracks: MusicTrack[] }
  | { type: 'play'; query: string; tracks: MusicTrack[]; track: MusicTrack; source: string };

export type AgentPersonality = 'calm' | 'warm' | 'direct' | 'coach' | 'creative';
export type AgentProactiveStyle = 'important' | 'balanced' | 'companion';

export interface AgentPersona {
  name: string;
  personality: AgentPersonality;
  proactiveStyle: AgentProactiveStyle;
  customInstructions: string;
}

export interface AgentModelProfile {
  id: string;
  name: string;
  apiBase: string;
  apiKey: string;
  model: string;
}

export interface AppSettings {
  profile: {
    name: string;
    nickname: string;
    role: string;
    about: string;
    currentFocus: string;
    avatarDataUrl: string;
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
  agent: {
    /** 当前默认配置的兼容镜像；主进程实际从 defaultModelProfileId 解析。 */
    apiBase: string;
    apiKey: string;
    model: string;
    modelProfiles: AgentModelProfile[];
    defaultModelProfileId: string;
    proactiveEnabled: boolean;
    emailMonitorEnabled: boolean;
    persona: AgentPersona;
  };
  sync: { url: string; token: string };
}

export interface MailAccount {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  hasPassword: boolean;
  configured: boolean;
}

export interface MailAccountInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  password?: string;
}

export interface MailAddress {
  name: string;
  address: string;
}

export interface MailFolder {
  path: string;
  name: string;
  specialUse: string | null;
}

export interface MailSummary {
  uid: number;
  folder: string;
  from: MailAddress[];
  to: MailAddress[];
  subject: string;
  date: string | null;
  receivedAt: string | null;
  size: number;
  seen: boolean;
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  size: number;
}

export interface MailMessage extends MailSummary {
  cc: MailAddress[];
  replyTo: MailAddress[];
  messageId: string | null;
  inReplyTo: string | null;
  text: string;
  html: string;
  bodyUnavailable: boolean;
  attachments: MailAttachment[];
}

export interface MailboxResult {
  account: MailAccount;
  folders: MailFolder[];
  folder: string;
  messages: MailSummary[];
  total: number;
  unseen: number;
}

export interface MailConnectionStatus {
  imap: boolean;
  smtp: boolean;
  imapError: string;
  smtpError: string;
}

export interface MailSendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
  deliveryId: string;
  dsnSupported: boolean;
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
  agentMessages: AgentDirectMessage[];
  agentGoals: AgentGoalRecord[];
    agentGoalActions: AgentGoalAction[];
    agentMemories: AgentMemory[];
    agentSkills: AgentSkill[];
    notificationHistory: NotificationHistoryItem[];
    profileItems: ProfileItem[];
    categories: Category[];
    music: MusicLibrary;
  };
}

export type AppUpdateState =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'up-to-date'
  | 'error';

export interface AppUpdateStatus {
  state: AppUpdateState;
  currentVersion: string;
  availableVersion: string | null;
  releaseNotes: string;
  releaseDate: string | null;
  downloadPercent: number | null;
  message: string;
  canCheck: boolean;
  canDownload: boolean;
  canCancel: boolean;
  canInstall: boolean;
}

export interface WorkspaceSnapshot {
  todos: Todo[];
  notes: Note[];
  categories: Category[];
  profileItems: ProfileItem[];
  settings: AppSettings;
}

export type TodayTimelineItemType = 'todo' | 'schedule';
export type TodayRecentItemType = 'note' | 'library';

export interface TodayFocusItem {
  id: string;
  title: string;
  priority: Priority;
  due: string | null;
  start: string | null;
  reason: string;
  goalTitle: string | null;
}

export interface TodayTimelineItem {
  id: string;
  title: string;
  at: string;
  time: string;
  type: TodayTimelineItemType;
  priority: Priority;
}

export interface TodayPendingItem {
  id: string;
  title: string;
  summary: string;
  messageId: string;
  status: AgentSuggestionStatus;
}

export interface TodayGoalItem {
  id: string;
  title: string;
  progress: number;
  completed: number;
  total: number;
  nextAction: string;
}

export interface TodayRecentItem {
  id: string;
  title: string;
  updatedAt: string;
  type: TodayRecentItemType;
}

export interface TodaySnapshot {
  date: string;
  focusItems: TodayFocusItem[];
  timeline: TodayTimelineItem[];
  timelineTotal: number;
  pending: TodayPendingItem[];
  activeGoals: TodayGoalItem[];
  recentCaptures: TodayRecentItem[];
}

export type WeeklyItemType = 'todo' | 'schedule';

export interface WeeklyItem {
  id: string;
  title: string;
  priority: Priority;
  at: string | null;
  type: WeeklyItemType;
}

export interface WeeklyRecentNote {
  id: string;
  title: string;
  updatedAt: string;
}

export interface WeeklyPlanEntry {
  id: string;
  start: string;
}

export interface WeeklyPlanResult {
  todoIds: string[];
}

export interface WeeklySnapshot {
  weekStart: string;
  weekEnd: string;
  nextWeekStart: string;
  nextWeekEnd: string;
  currentWeek: WeeklyItem[];
  currentWeekTotal: number;
  overdue: WeeklyItem[];
  overdueCount: number;
  nextWeek: WeeklyItem[];
  nextWeekTotal: number;
  recentNotes: WeeklyRecentNote[];
  captureCount: number;
  activeGoalCount: number;
}

export type BackupReason = 'auto' | 'manual' | 'pre-restore';

export interface BackupRecord {
  id: string;
  reason: BackupReason;
  createdAt: string;
  size: number;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  source?: 'chat' | 'proactive' | 'follow-up';
  createdAt?: string;
  proactiveMessageId?: string;
  suggestionId?: string;
  goalId?: string | null;
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

export type AgentGoalStatus = 'active' | 'paused' | 'completed' | 'archived';
export type AgentGoalActionType = 'todo' | 'suggestion' | 'follow-up';
export type AgentGoalActionStatus = 'pending' | 'completed' | 'dismissed' | 'removed';

export interface AgentGoalRecord {
  id: string;
  title: string;
  description: string;
  status: AgentGoalStatus;
  targetDate: string | null;
  outcome: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AgentGoalAction {
  id: string;
  goalId: string;
  type: AgentGoalActionType;
  title: string;
  status: AgentGoalActionStatus;
  todoId: string | null;
  suggestionId: string | null;
  followUpAt: string | null;
  outcome: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AgentGoalSummary {
  total: number;
  completed: number;
  pending: number;
  dismissed: number;
  removed: number;
  progress: number;
}

export interface AgentGoal extends AgentGoalRecord {
  summary: AgentGoalSummary;
  actions: AgentGoalAction[];
}

export type AgentMemoryKind = 'preference' | 'fact' | 'instruction';
export type AgentMemoryStatus = 'candidate' | 'active' | 'rejected' | 'archived';

export interface AgentMemory {
  id: string;
  content: string;
  kind: AgentMemoryKind;
  status: AgentMemoryStatus;
  source: string;
  replacesId: string | null;
  replacedById: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}

export type AgentSkillStatus = 'candidate' | 'active' | 'rejected' | 'archived';

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  status: AgentSkillStatus;
  source: string;
  replacesId: string | null;
  replacedById: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  lastUsedAt: string | null;
}

export type AgentTrigger = 'daily-briefing' | 'event-follow-up' | 'mail-triage';
export type AgentRunStatus = 'running' | 'completed' | 'failed';
export type AgentSuggestionStatus = 'unread' | 'read' | 'dismissed' | 'acted';
export type AgentRunContext = 'todos' | 'schedule' | 'notes' | 'library' | 'current-time' | 'goals' | 'memories' | 'skills' | 'mail';
export type AgentRunDelivery = 'none' | 'in-app' | 'desktop-notification';
export type MailPriority = 'high' | 'medium' | 'low';

export interface AgentSuggestionReference {
  type: 'todo' | 'schedule' | 'note' | 'library' | 'mail';
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
  priority?: MailPriority | null;
  references: AgentSuggestionReference[];
  proposal?: AgentProposal | null;
  goalId?: string | null;
  messageId?: string | null;
  status: AgentSuggestionStatus;
  createdAt: string;
  updatedAt: string;
  notifiedAt: string | null;
  followUpAt: string | null;
}

export type AgentDirectMessagePhase = 'initial' | 'follow-up';

export interface AgentDirectMessage {
  id: string;
  phase: AgentDirectMessagePhase;
  suggestionId: string;
  goalId: string | null;
  title: string;
  content: string;
  proposal: AgentProposal | null;
  createdAt: string;
  readAt: string | null;
  conversationId: string | null;
}

export interface AgentProactiveAlert {
  messageId: string;
  phase: AgentDirectMessagePhase;
  title: string;
  summary: string;
  reason: string;
  priority?: MailPriority;
  createdAt: string;
}

export interface TaskNotification {
  eventKey: string;
  title: string;
  body: string;
  todoId?: string;
  todoTitle?: string;
  urgency?: 'scheduled' | 'urgent' | 'overdue';
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
  contextTypes?: AgentRunContext[];
  decision?: string;
  delivery?: AgentRunDelivery;
  error?: string;
}

export type AgentProposal = { operationId?: string } & (
  | { kind: 'create_todo'; title: string; priority: Priority; due: string | null; goalId?: string | null }
  | { kind: 'create_note'; title: string; content: string }
  | { kind: 'save_important_date'; title: string; date: string }
  | { kind: 'save_preference'; preference: string }
  | { kind: 'create_goal'; title: string; description: string; targetDate: string | null }
  | { kind: 'create_memory_candidate'; content: string; memoryKind: AgentMemoryKind; replacesId: string | null }
  | { kind: 'create_skill_candidate'; name: string; description: string; instructions: string; replacesId: string | null }
  | { kind: 'send_email'; to: string; cc: string; subject: string; text: string; inReplyTo: string | null }
  | { kind: 'add_music_to_playlist'; playlistId: number; playlistName: string; trackId: number; trackTitle: string }
  | { kind: 'remove_music_from_playlist'; playlistId: number; playlistName: string; trackId: number; trackTitle: string }
);

export interface AgentReply {
  content: string;
  proposal?: AgentProposal;
}

export interface WorkbenchApi {
  appInfo: () => Promise<{ name: string; version: string; platform: string }>;
  updates: {
    status: () => Promise<AppUpdateStatus>;
    check: () => Promise<AppUpdateStatus>;
    download: () => Promise<AppUpdateStatus>;
    cancel: () => Promise<AppUpdateStatus>;
    install: () => Promise<AppUpdateStatus>;
    onStatus: (callback: (status: AppUpdateStatus) => void) => () => void;
  };
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
  backup: {
    list: () => Promise<BackupRecord[]>;
    create: () => Promise<BackupRecord | null>;
    restore: (id: string) => Promise<{ restored: boolean; restoredAt?: string; backup?: BackupRecord | null }>;
    exportData: () => Promise<{ saved: boolean; filePath?: string }>;
  };
  today: {
    getSnapshot: () => Promise<TodaySnapshot>;
  };
  weekly: {
    getSnapshot: () => Promise<WeeklySnapshot>;
    applyPlan: (entries: WeeklyPlanEntry[]) => Promise<WeeklyPlanResult>;
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
        agentGoalId?: string | null;
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
  music: {
    serviceStatus: () => Promise<MusicServiceStatus>;
    search: (query: string) => Promise<MusicTrack[]>;
    hotSearch: () => Promise<string[]>;
    trackDetails: (id: number) => Promise<MusicTrack | null>;
    lyrics: (id: number) => Promise<MusicLyricLine[]>;
    playbackUrl: (id: number) => Promise<string>;
    accountState: () => Promise<MusicLibrary>;
    startQrLogin: () => Promise<{ key: string; qrImage: string; qrUrl: string | null; expiresAt: number }>;
    checkQrLogin: (key: string) => Promise<{
      status: 'waiting-scan' | 'waiting-confirm' | 'expired' | 'authorized' | 'error';
      message: string;
      account?: MusicAccount;
      library?: MusicLibrary;
    }>;
    syncAccount: () => Promise<MusicLibrary>;
    syncPlaylist: (id: number) => Promise<{ tracks: MusicTrack[]; library: MusicLibrary }>;
    preparePlaylistMutation: (operation: 'add' | 'del', playlistId: number, trackId: number) => Promise<{ operationId: string }>;
    addToPlaylist: (playlistId: number, trackId: number, operationId: string) => Promise<MusicPlaylistMutationResult>;
    removeFromPlaylist: (playlistId: number, trackId: number, operationId: string) => Promise<MusicPlaylistMutationResult>;
    logout: () => Promise<MusicLibrary>;
  };
  mail: {
    account: () => Promise<MailAccount>;
    saveAccount: (input: MailAccountInput) => Promise<MailAccount>;
    verify: (input?: MailAccountInput) => Promise<MailConnectionStatus>;
    list: (folder?: string, limit?: number) => Promise<MailboxResult>;
    getMessage: (folder: string, uid: number) => Promise<MailMessage>;
    markRead: (folder: string, uid: number) => Promise<{ folder: string; uid: number }>;
    prepareSend: (input: { to: string; cc?: string; subject: string; text: string; inReplyTo?: string }) => Promise<{ operationId: string }>;
    send: (input: { to: string; cc?: string; subject: string; text: string; inReplyTo?: string }, operationId: string) => Promise<MailSendResult>;
  };
  agent: {
    status: () => Promise<boolean>;
    chat: (messages: ChatMessage[], onDelta?: (delta: string) => void) => Promise<AgentReply>;
    confirmProposal: (proposal: AgentProposal) => Promise<{ content: string }>;
    getSuggestions: () => Promise<AgentSuggestion[]>;
    getSuggestionHistory: () => Promise<AgentSuggestion[]>;
    getMessages: () => Promise<AgentDirectMessage[]>;
    markMessageRead: (id: string, conversationId: string) => Promise<AgentDirectMessage | null>;
    updateSuggestion: (id: string, patch: { status: AgentSuggestionStatus; followUpAt?: string | null }) => Promise<AgentSuggestion[]>;
    linkSuggestionToGoal: (id: string, goalId: string) => Promise<AgentSuggestion[]>;
    checkProactive: (force?: boolean) => Promise<AgentSuggestion[]>;
    getGoals: (includeArchived?: boolean) => Promise<AgentGoal[]>;
    createGoal: (input: Pick<AgentGoalRecord, 'title'> & Partial<Pick<AgentGoalRecord, 'description' | 'targetDate'>>) => Promise<AgentGoal>;
    updateGoal: (id: string, patch: Partial<Pick<AgentGoalRecord, 'title' | 'description' | 'targetDate' | 'status' | 'outcome'>>) => Promise<AgentGoal>;
    addGoalAction: (input: Pick<AgentGoalAction, 'goalId' | 'title'> & Partial<Pick<AgentGoalAction, 'type' | 'followUpAt' | 'outcome' | 'status'>>) => Promise<AgentGoalAction>;
    updateGoalAction: (id: string, patch: Partial<Pick<AgentGoalAction, 'title' | 'status' | 'followUpAt' | 'outcome'>>) => Promise<AgentGoalAction>;
    getMemories: (includeArchived?: boolean) => Promise<AgentMemory[]>;
    reviewMemory: (id: string, decision: 'activate' | 'reject' | 'archive' | 'restore') => Promise<AgentMemory | null>;
    getSkills: (includeArchived?: boolean) => Promise<AgentSkill[]>;
    reviewSkill: (id: string, decision: 'activate' | 'reject' | 'archive' | 'restore') => Promise<AgentSkill | null>;
    onProactiveUpdated: (callback: () => void) => () => void;
    onProactiveAlert: (callback: (alert: AgentProactiveAlert) => void) => () => void;
    onStateUpdated: (callback: () => void) => () => void;
    onOpenAgent: (callback: (messageId?: string) => void) => () => void;
    onMusicCommand: (callback: (command: AgentMusicCommand) => void) => () => void;
  };
  notify: {
    checkTodos: () => Promise<TaskNotification[]>;
    sendNtfy: (title: string, message: string) => Promise<void>;
  };
}

declare global {
  interface Window {
    workbench: WorkbenchApi;
  }
}
