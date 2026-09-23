const store = require('./store.cjs');

const MAX_GOALS = 60;
const MAX_ACTIONS = 240;
const MAX_MEMORIES = 120;
// 归档与已丢弃的历史单独计数，避免它们挤占生效记忆的额度，也避免无限增长。
const MAX_ARCHIVED_MEMORIES = 240;
const MAX_SKILLS = 60;

const LIVE_MEMORY_STATUSES = new Set(['active', 'candidate']);
const RETIRED_MEMORY_STATUSES = new Set(['archived', 'rejected']);
// 使用次数按窗口合并写入，避免每轮对话都重写整份数据文件。
const USAGE_FLUSH_MIN_INTERVAL_MS = 10_000;
const USAGE_FLUSH_MAX_PENDING = 20;
// 近似重复阈值：达到该值即视为在讲同一件事，采纳新记忆时会取代旧条。
const SIMILAR_MEMORY_THRESHOLD = 0.8;
const MAX_SIMILAR_MEMORIES = 3;
// 方向相反的表述通常低于“近似重复”阈值，单独用更低的阈值识别，且只做提示不自动处理。
const CONFLICT_SIMILARITY_THRESHOLD = 0.45;
// 久未使用提示的判定天数。
const STALE_MEMORY_DAYS = 30;
// 否定标记：用于识别“同一件事的正反两种说法”。
const NEGATION_MARKERS = ['不要', '不用', '不再', '不需要', '无需', '禁止', '取消', '停止', '戒掉', 'never', 'not ', "don't", 'avoid'];

const GOAL_STATUSES = new Set(['active', 'paused', 'completed', 'archived']);
const ACTION_STATUSES = new Set(['pending', 'completed', 'dismissed', 'removed']);
const MEMORY_STATUSES = new Set(['candidate', 'active', 'rejected', 'archived']);
const MEMORY_KINDS = new Set(['preference', 'fact', 'instruction']);
const SKILL_STATUSES = new Set(['candidate', 'active', 'rejected', 'archived']);

function safeText(value, limit = 800) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function timestamp() {
  return new Date().toISOString();
}

function validIsoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

/** 记忆是否已过有效期。未设置有效期的记忆视为长期有效。 */
function isMemoryExpired(memory, now = new Date()) {
  if (!memory?.validUntil) return false;
  const expiresAt = new Date(memory.validUntil).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt <= now.getTime();
}

function termSet(value) {
  return new Set(queryTerms(value));
}

/** 归一化文本：忽略标点、空白与大小写差异，用于判断“是不是同一句话”。 */
function normaliseMemoryText(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function hasNegation(value) {
  const text = String(value || '').toLowerCase();
  return NEGATION_MARKERS.some((marker) => text.includes(marker));
}

/** 生效、未置顶、且超过 STALE_MEMORY_DAYS 未被命中的记忆，视为久未使用。 */
function isMemoryStale(memory, now = new Date()) {
  if (memory?.status !== 'active' || memory.pinned) return false;
  const reference = memory.lastUsedAt || memory.createdAt;
  const time = new Date(reference || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) return false;
  return now.getTime() - time > STALE_MEMORY_DAYS * 24 * 60 * 60 * 1000;
}

/** 词法近重复打分：既看整体重合度，也看短句是否被长句完全包含。 */
function similarityScore(left, right) {
  const a = termSet(left);
  const b = termSet(right);
  if (a.size < 2 || b.size < 2) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared += 1;
  if (shared < 2) return 0;
  const union = a.size + b.size - shared;
  const jaccard = union ? shared / union : 0;
  const smaller = Math.min(a.size, b.size);
  const containment = smaller >= 3 ? shared / smaller : 0;
  return Math.max(jaccard, containment);
}

/** 找出与待写入内容近似重复的生效记忆，用于在采纳时取代旧条，而不是让矛盾内容并存。 */
function findSimilarMemories(content, kind, { excludeIds = [], now = new Date() } = {}) {
  const excluded = new Set(excludeIds.filter(Boolean));
  return rawMemories()
    .filter((memory) => memory.status === 'active'
      && memory.kind === kind
      && !excluded.has(memory.id)
      && !isMemoryExpired(memory, now))
    .map((memory) => ({ memory, score: similarityScore(content, memory.content) }))
    .filter(({ score }) => score >= SIMILAR_MEMORY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SIMILAR_MEMORIES);
}

/**
 * 找出可能与待写入内容方向相反的记忆（一方有否定标记、另一方没有）。
 * 这类内容相似度通常低于去重阈值，所以单独判定，并且只用于提示，不会自动归档。
 */
function findConflictingMemories(content, kind, { excludeIds = [], now = new Date() } = {}) {
  const excluded = new Set(excludeIds.filter(Boolean));
  const negated = hasNegation(content);
  return rawMemories()
    .filter((memory) => memory.status === 'active'
      && memory.kind === kind
      && !excluded.has(memory.id)
      && !isMemoryExpired(memory, now)
      && hasNegation(memory.content) !== negated)
    .map((memory) => ({ memory, score: similarityScore(content, memory.content) }))
    .filter(({ score }) => score >= CONFLICT_SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SIMILAR_MEMORIES);
}

/** 淘汰优先级：已过期 > 未置顶 > 使用次数少 > 最久未使用 > 最久未更新。 */
function pickEvictionVictim(items, now = new Date()) {
  const ranked = items
    .filter((memory) => memory?.status === 'active')
    .map((memory) => ({
      memory,
      rank: [
        isMemoryExpired(memory, now) ? 0 : 1,
        memory.pinned ? 1 : 0,
        Number(memory.usageCount || 0),
        String(memory.lastUsedAt || ''),
        String(memory.updatedAt || memory.createdAt || ''),
      ],
    }));
  if (!ranked.length) return null;
  ranked.sort((left, right) => {
    for (let index = 0; index < left.rank.length; index += 1) {
      if (left.rank[index] < right.rank[index]) return -1;
      if (left.rank[index] > right.rank[index]) return 1;
    }
    return 0;
  });
  return ranked[0].memory;
}

function oldestIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}

/**
 * 容量控制分两段，避免旧实现直接用 slice 截断、把最旧的生效记忆静默删除：
 * 1. 生效 + 候选超过 MAX_MEMORIES 时，把最久未使用的生效记忆归档（可恢复），仍无处腾挪才丢弃最旧候选；
 * 2. 归档 + 已丢弃超过 MAX_ARCHIVED_MEMORIES 时，才真正删除最旧的历史记录。
 */
function applyMemoryCapacity(items, now = new Date()) {
  let next = items.slice();
  const stamp = now.toISOString();
  const liveCount = () => next.filter((memory) => LIVE_MEMORY_STATUSES.has(memory?.status)).length;
  const retiredCount = () => next.filter((memory) => RETIRED_MEMORY_STATUSES.has(memory?.status)).length;
  while (liveCount() > MAX_MEMORIES) {
    const victim = pickEvictionVictim(next, now);
    if (victim) {
      next = next.map((memory) => (memory.id === victim.id
        ? { ...memory, status: 'archived', archivedReason: 'capacity', reviewedAt: stamp, updatedAt: stamp }
        : memory));
      continue;
    }
    const index = oldestIndex(next, (memory) => memory?.status === 'candidate');
    if (index < 0) break;
    next = next.slice(0, index).concat(next.slice(index + 1));
  }
  while (retiredCount() > MAX_ARCHIVED_MEMORIES) {
    const index = oldestIndex(next, (memory) => RETIRED_MEMORY_STATUSES.has(memory?.status));
    if (index < 0) break;
    next = next.slice(0, index).concat(next.slice(index + 1));
  }
  return next;
}

const pendingUsage = new Map();
let usageFlushedAt = 0;

function flushMemoryUsage(now = Date.now()) {
  if (!pendingUsage.size) return 0;
  const counts = new Map(pendingUsage);
  pendingUsage.clear();
  usageFlushedAt = now;
  const stamp = new Date(now).toISOString();
  let touched = 0;
  store.updateModule('agentMemories', (items) => items.map((memory) => {
    const count = memory?.id ? counts.get(memory.id) : 0;
    if (!count) return memory;
    touched += 1;
    return { ...memory, usageCount: Number(memory.usageCount || 0) + count, lastUsedAt: stamp };
  }));
  return touched;
}

function touchMemories(ids, now = Date.now()) {
  for (const id of ids) {
    if (!id) continue;
    pendingUsage.set(id, (pendingUsage.get(id) || 0) + 1);
  }
  if (pendingUsage.size >= USAGE_FLUSH_MAX_PENDING || now - usageFlushedAt >= USAGE_FLUSH_MIN_INTERVAL_MS) {
    flushMemoryUsage(now);
  }
}

function rawGoals() {
  return store.getModule('agentGoals').filter((goal) => goal && goal.id);
}

function rawActions() {
  return store.getModule('agentGoalActions').filter((action) => action && action.id && action.goalId);
}

function rawMemories() {
  return store.getModule('agentMemories').filter((memory) => memory && memory.id && memory.content);
}

function rawSkills() {
  return store.getModule('agentSkills').filter((skill) => skill && skill.id && skill.name && skill.instructions);
}

function getRawGoal(id) {
  return rawGoals().find((goal) => goal.id === id) || null;
}

function normaliseGoalInput(input = {}, existing = null) {
  const title = input.title === undefined ? existing?.title : safeText(input.title, 160);
  if (!title) throw new Error('目标标题不能为空');
  const description = input.description === undefined ? (existing?.description || '') : safeText(input.description, 1200);
  const targetDate = input.targetDate === undefined ? (existing?.targetDate || null) : validIsoDate(input.targetDate);
  if (targetDate === undefined) throw new Error('目标日期无效');
  const status = input.status === undefined ? (existing?.status || 'active') : input.status;
  if (!GOAL_STATUSES.has(status)) throw new Error('目标状态无效');
  const outcome = input.outcome === undefined ? (existing?.outcome || '') : safeText(input.outcome, 1200);
  return { title, description, targetDate, status, outcome };
}

function actionSummary(goalId) {
  const actions = rawActions().filter((action) => action.goalId === goalId);
  const tracked = actions.filter((action) => !['dismissed', 'removed'].includes(action.status));
  const completed = tracked.filter((action) => action.status === 'completed').length;
  const pending = tracked.filter((action) => action.status === 'pending').length;
  return {
    total: tracked.length,
    completed,
    pending,
    dismissed: actions.filter((action) => action.status === 'dismissed').length,
    removed: actions.filter((action) => action.status === 'removed').length,
    progress: tracked.length ? Math.round((completed / tracked.length) * 100) : 0,
  };
}

function decorateGoal(goal) {
  const summary = actionSummary(goal.id);
  const actions = rawActions()
    .filter((action) => action.goalId === goal.id)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return {
    ...goal,
    summary: {
      ...summary,
      progress: goal.status === 'completed' ? 100 : summary.progress,
    },
    actions,
  };
}

function listGoals({ includeArchived = false } = {}) {
  const rank = { active: 0, paused: 1, completed: 2, archived: 3 };
  return rawGoals()
    .filter((goal) => includeArchived || !['archived'].includes(goal.status))
    .sort((a, b) => (rank[a.status] - rank[b.status]) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(decorateGoal);
}

function getGoal(id) {
  const goal = getRawGoal(safeText(id, 120));
  return goal ? decorateGoal(goal) : null;
}

function assertActionableGoal(goalId) {
  const goal = getRawGoal(safeText(goalId, 120));
  if (!goal) throw new Error('关联的目标不存在');
  if (goal.status !== 'active') throw new Error('只有进行中的目标可以添加行动');
  return goal;
}

function createGoal(input = {}) {
  const now = timestamp();
  const goal = {
    id: store.newId(),
    ...normaliseGoalInput(input),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  store.updateModule('agentGoals', (goals) => [goal, ...goals].slice(0, MAX_GOALS));
  return getGoal(goal.id);
}

function updateGoal(id, patch = {}) {
  const current = getRawGoal(safeText(id, 120));
  if (!current) throw new Error('目标不存在');
  const next = normaliseGoalInput(patch, current);
  const now = timestamp();
  const completedAt = next.status === 'completed'
    ? current.completedAt || now
    : null;
  store.updateModule('agentGoals', (goals) => goals.map((goal) => (
    goal.id === current.id ? { ...goal, ...next, completedAt, updatedAt: now } : goal
  )));
  return getGoal(current.id);
}

function actionStatusFromTodo(todo) {
  return todo ? (todo.done ? 'completed' : 'pending') : 'removed';
}

function actionStatusFromSuggestion(suggestion) {
  if (!suggestion) return 'removed';
  if (suggestion.status === 'acted') return 'completed';
  if (suggestion.status === 'dismissed') return 'dismissed';
  return 'pending';
}

function addGoalAction(input = {}) {
  const goal = assertActionableGoal(input.goalId);
  const title = safeText(input.title, 240);
  if (!title) throw new Error('跟进行动需要标题');
  const type = ['todo', 'suggestion', 'follow-up'].includes(input.type) ? input.type : 'follow-up';
  const followUpAt = validIsoDate(input.followUpAt);
  if (followUpAt === undefined) throw new Error('跟进时间无效');
  const now = timestamp();
  const action = {
    id: store.newId(),
    goalId: goal.id,
    type,
    title,
    status: ACTION_STATUSES.has(input.status) ? input.status : 'pending',
    todoId: safeText(input.todoId, 120) || null,
    suggestionId: safeText(input.suggestionId, 120) || null,
    followUpAt: followUpAt || null,
    outcome: safeText(input.outcome, 1200),
    createdAt: now,
    updatedAt: now,
    completedAt: input.status === 'completed' ? now : null,
  };
  store.updateModule('agentGoalActions', (actions) => [action, ...actions].slice(0, MAX_ACTIONS));
  return action;
}

function linkTodo(goalId, todo) {
  if (!todo?.id) return null;
  const existing = rawActions().find((action) => action.goalId === goalId && action.todoId === todo.id);
  if (existing) return syncTodo(todo);
  return addGoalAction({
    goalId,
    type: 'todo',
    title: safeText(todo.title, 240),
    todoId: todo.id,
    status: actionStatusFromTodo(todo),
  });
}

function linkSuggestion(goalId, suggestion) {
  if (!suggestion?.id || !goalId) return null;
  const goal = getRawGoal(goalId);
  if (!goal || goal.status === 'archived') return null;
  const existing = rawActions().find((action) => action.goalId === goal.id && action.suggestionId === suggestion.id);
  if (existing) return syncSuggestion(suggestion);
  const now = timestamp();
  const action = {
    id: store.newId(),
    goalId: goal.id,
    type: 'suggestion',
    title: safeText(suggestion.title, 240),
    status: actionStatusFromSuggestion(suggestion),
    todoId: null,
    suggestionId: suggestion.id,
    followUpAt: null,
    outcome: '',
    createdAt: now,
    updatedAt: now,
    completedAt: suggestion.status === 'acted' ? now : null,
  };
  store.updateModule('agentGoalActions', (actions) => [action, ...actions].slice(0, MAX_ACTIONS));
  return action;
}

function syncTodo(todo) {
  if (!todo?.id) return [];
  const status = actionStatusFromTodo(todo);
  const now = timestamp();
  const changed = [];
  store.updateModule('agentGoalActions', (actions) => actions.map((action) => {
    if (action.todoId !== todo.id) return action;
    const next = {
      ...action,
      title: safeText(todo.title, 240) || action.title,
      status,
      completedAt: status === 'completed' ? action.completedAt || now : null,
      updatedAt: now,
    };
    changed.push(next);
    return next;
  }));
  return changed;
}

function markTodoRemoved(todoId) {
  const id = safeText(todoId, 120);
  if (!id) return [];
  const now = timestamp();
  const changed = [];
  store.updateModule('agentGoalActions', (actions) => actions.map((action) => {
    if (action.todoId !== id) return action;
    const next = { ...action, status: 'removed', completedAt: null, updatedAt: now };
    changed.push(next);
    return next;
  }));
  return changed;
}

function syncSuggestion(suggestion) {
  if (!suggestion?.id) return [];
  const status = actionStatusFromSuggestion(suggestion);
  const now = timestamp();
  const changed = [];
  store.updateModule('agentGoalActions', (actions) => actions.map((action) => {
    if (action.suggestionId !== suggestion.id) return action;
    const next = {
      ...action,
      title: safeText(suggestion.title, 240) || action.title,
      status,
      completedAt: status === 'completed' ? action.completedAt || now : null,
      updatedAt: now,
    };
    changed.push(next);
    return next;
  }));
  return changed;
}

function updateGoalAction(id, patch = {}) {
  const actionId = safeText(id, 120);
  const current = rawActions().find((action) => action.id === actionId);
  if (!current) throw new Error('跟进行动不存在');
  const title = patch.title === undefined ? current.title : safeText(patch.title, 240);
  if (!title) throw new Error('跟进行动需要标题');
  const status = patch.status === undefined ? current.status : patch.status;
  if (!ACTION_STATUSES.has(status)) throw new Error('跟进状态无效');
  const followUpAt = patch.followUpAt === undefined ? current.followUpAt : validIsoDate(patch.followUpAt);
  if (followUpAt === undefined) throw new Error('跟进时间无效');
  const outcome = patch.outcome === undefined ? current.outcome : safeText(patch.outcome, 1200);
  const now = timestamp();
  const next = {
    ...current,
    title,
    status,
    followUpAt: followUpAt || null,
    outcome,
    completedAt: status === 'completed' ? current.completedAt || now : null,
    updatedAt: now,
  };
  store.updateModule('agentGoalActions', (actions) => actions.map((action) => action.id === current.id ? next : action));
  return next;
}

function createMemoryCandidate(input = {}) {
  const content = safeText(input.content, 600);
  if (!content) throw new Error('记忆内容不能为空');
  const kind = MEMORY_KINDS.has(input.kind) ? input.kind : 'preference';
  const replacesId = safeText(input.replacesId, 120) || null;
  if (replacesId && !rawMemories().some((memory) => memory.id === replacesId && memory.status === 'active')) {
    throw new Error('要替换的长期记忆不存在或未生效');
  }
  const validUntil = validIsoDate(input.validUntil);
  if (validUntil === undefined) throw new Error('记忆有效期无效');
  // 归一化去重：标点、空格与大小写差异不再产生第二条候选；内容已生效时直接复用同一条。
  const normalised = normaliseMemoryText(content);
  const duplicate = rawMemories().find((memory) => ['candidate', 'active'].includes(memory.status)
    && memory.kind === kind
    && normaliseMemoryText(memory.content) === normalised);
  if (duplicate) return duplicate;
  const now = timestamp();
  const similarIds = [...new Set([
    replacesId,
    ...findSimilarMemories(content, kind, { excludeIds: [replacesId] }).map(({ memory }) => memory.id),
  ].filter(Boolean))];
  const memory = {
    id: store.newId(),
    content,
    kind,
    status: 'candidate',
    source: safeText(input.source, 60) || 'agent',
    replacesId,
    replacedById: null,
    validUntil: validUntil || null,
    similarIds,
    pinned: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
  };
  store.updateModule('agentMemories', (items) => applyMemoryCapacity([memory, ...items], new Date(now)));
  return memory;
}

/** 修改记忆措辞。只有候选与生效中的记忆可编辑，且不能与其它记忆重复。 */
function updateMemory(id, content) {
  const memoryId = safeText(id, 120);
  const current = rawMemories().find((memory) => memory.id === memoryId);
  if (!current) throw new Error('长期记忆不存在');
  if (!['candidate', 'active'].includes(current.status)) throw new Error('已归档或已丢弃的记忆不能编辑');
  const nextContent = safeText(content, 600);
  if (!nextContent) throw new Error('记忆内容不能为空');
  if (nextContent === current.content) return listMemories({ includeArchived: true }).find((memory) => memory.id === current.id) || null;
  const normalised = normaliseMemoryText(nextContent);
  const clash = rawMemories().some((memory) => memory.id !== current.id
    && ['candidate', 'active'].includes(memory.status)
    && memory.kind === current.kind
    && normaliseMemoryText(memory.content) === normalised);
  if (clash) throw new Error('已存在内容相同的记忆');
  const now = timestamp();
  const similarIds = [...new Set([
    current.replacesId,
    ...findSimilarMemories(nextContent, current.kind, { excludeIds: [current.id, current.replacesId] }).map(({ memory }) => memory.id),
  ].filter(Boolean))];
  store.updateModule('agentMemories', (items) => items.map((memory) => (
    memory.id === current.id ? { ...memory, content: nextContent, similarIds, updatedAt: now } : memory
  )));
  return listMemories({ includeArchived: true }).find((memory) => memory.id === current.id) || null;
}

function listMemories({ includeArchived = false } = {}) {
  const rank = { candidate: 0, active: 1, rejected: 2, archived: 3 };
  const now = new Date();
  return rawMemories()
    .filter((memory) => includeArchived || !['rejected', 'archived'].includes(memory.status))
    .sort((a, b) => (rank[a.status] - rank[b.status])
      || (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
      || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((memory) => ({ ...memory, expired: isMemoryExpired(memory, now), stale: isMemoryStale(memory, now) }));
}

function reviewMemory(id, decision) {
  const memoryId = safeText(id, 120);
  const current = rawMemories().find((memory) => memory.id === memoryId);
  if (!current) throw new Error('长期记忆不存在');
  // 置顶只改变常驻标记，不改变记忆状态。
  if (decision === 'pin' || decision === 'unpin') {
    if (current.status !== 'active') throw new Error('只有生效中的记忆可以置顶');
    const pinned = decision === 'pin';
    store.updateModule('agentMemories', (items) => items.map((memory) => (
      memory.id === current.id ? { ...memory, pinned } : memory
    )));
    return listMemories({ includeArchived: true }).find((memory) => memory.id === current.id) || null;
  }
  const nextStatus = ({ activate: 'active', reject: 'rejected', archive: 'archived', restore: 'active' })[decision];
  if (!nextStatus) throw new Error('记忆审核操作无效');
  if (decision === 'activate' && current.status !== 'candidate') throw new Error('只有候选记忆可以采纳');
  if (decision === 'reject' && current.status !== 'candidate') throw new Error('只有候选记忆可以丢弃');
  if (decision === 'restore' && current.status !== 'archived') throw new Error('只有已归档记忆可以恢复');
  const now = timestamp();
  const supersedeIds = new Set(decision === 'activate'
    ? [current.replacesId, ...(Array.isArray(current.similarIds) ? current.similarIds : [])].filter((item) => item && item !== current.id)
    : []);
  store.updateModule('agentMemories', (items) => items.map((memory) => {
    if (memory.id === current.id) {
      return {
        ...memory,
        status: nextStatus,
        ...(decision === 'restore' ? { replacedById: null } : {}),
        reviewedAt: now,
        updatedAt: now,
      };
    }
    if (supersedeIds.has(memory.id) && memory.status === 'active') {
      return { ...memory, status: 'archived', replacedById: current.id, reviewedAt: now, updatedAt: now };
    }
    if (decision === 'restore' && current.replacedById && memory.id === current.replacedById && memory.status === 'active') {
      return { ...memory, status: 'archived', replacedById: current.id, reviewedAt: now, updatedAt: now };
    }
    return memory;
  }));
  return listMemories({ includeArchived: true }).find((memory) => memory.id === current.id) || null;
}

function queryTerms(value) {
  const text = safeText(value, 2000).toLowerCase();
  if (!text) return [];
  const chunks = text.match(/[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9_-]*/g) || [];
  return [...new Set(chunks.flatMap((chunk) => {
    if (/^[\u4e00-\u9fff]+$/.test(chunk) && chunk.length > 2) {
      return [chunk, ...Array.from({ length: chunk.length - 1 }, (_, index) => chunk.slice(index, index + 2))];
    }
    return [chunk];
  }))];
}

function buildTermStats(texts) {
  const df = new Map();
  for (const text of texts) {
    for (const term of new Set(queryTerms(text))) df.set(term, (df.get(term) || 0) + 1);
  }
  return { size: texts.length, df };
}

/**
 * 相关性打分 = 命中权重 × IDF ÷ 记忆长度。
 * IDF 压低“用户”“工作”这类几乎每条都命中的常见词；长度归一化避免长记忆仅凭篇幅累积分数。
 */
function relevanceScore(query, value, stats = null) {
  const terms = queryTerms(query);
  if (!terms.length) return 0;
  const text = safeText(value, 6000).toLowerCase();
  const documentTerms = Math.max(1, queryTerms(value).length);
  let score = 0;
  for (const term of terms) {
    if (!text.includes(term)) continue;
    const frequency = stats?.df.get(term) || 0;
    const idf = stats && stats.size > 0 ? Math.log(1 + stats.size / (1 + frequency)) : 1;
    score += (term.length > 2 ? 3 : 1) * idf;
  }
  return score ? score / Math.sqrt(documentTerms) : 0;
}

function rankMemories(query, { limit = 6, now = new Date(), touch = true } = {}) {
  const hasQuery = queryTerms(query).length > 0;
  const candidates = rawMemories()
    .filter((memory) => memory.status === 'active' && !isMemoryExpired(memory, now));
  const stats = buildTermStats(candidates.map((memory) => memory.content));
  const ranked = candidates
    .map((memory) => ({ memory, score: relevanceScore(query, memory.content, stats) }))
    // 置顶记忆始终常驻，不会因为当前问题用词不同而被挤掉。
    .filter(({ memory, score }) => memory.pinned || !hasQuery || score > 0)
    .sort((a, b) => (Number(Boolean(b.memory.pinned)) - Number(Boolean(a.memory.pinned)))
      || (b.score - a.score)
      || String(b.memory.updatedAt).localeCompare(String(a.memory.updatedAt)))
    .slice(0, limit);
  if (touch && ranked.length) touchMemories(ranked.map(({ memory }) => memory.id), now.getTime());
  return ranked;
}

function findRelevantMemories(query, limit = 6) {
  return rankMemories(query, { limit }).map(({ memory }) => memory);
}

function createSkillCandidate(input = {}) {
  const name = safeText(input.name, 100);
  const description = safeText(input.description, 360);
  const instructions = String(input.instructions || '').trim().slice(0, 5000);
  if (!name || !description || !instructions) throw new Error('Skill 需要名称、用途和可执行步骤');
  const replacesId = safeText(input.replacesId, 120) || null;
  if (replacesId && !rawSkills().some((skill) => skill.id === replacesId && skill.status === 'active')) {
    throw new Error('要替换的 Skill 不存在或未启用');
  }
  const duplicate = rawSkills().find((skill) => skill.status === 'candidate' && skill.name === name && skill.instructions === instructions);
  if (duplicate) return duplicate;
  const now = timestamp();
  const skill = {
    id: store.newId(),
    name,
    description,
    instructions,
    status: 'candidate',
    source: safeText(input.source, 60) || 'agent',
    replacesId,
    replacedById: null,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    lastUsedAt: null,
  };
  store.updateModule('agentSkills', (items) => [skill, ...items].slice(0, MAX_SKILLS));
  return skill;
}

function listSkills({ includeArchived = false } = {}) {
  const rank = { candidate: 0, active: 1, rejected: 2, archived: 3 };
  return rawSkills()
    .filter((skill) => includeArchived || !['rejected', 'archived'].includes(skill.status))
    .sort((a, b) => (rank[a.status] - rank[b.status]) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function reviewSkill(id, decision) {
  const skillId = safeText(id, 120);
  const current = rawSkills().find((skill) => skill.id === skillId);
  if (!current) throw new Error('Skill 不存在');
  const nextStatus = ({ activate: 'active', reject: 'rejected', archive: 'archived', restore: 'active' })[decision];
  if (!nextStatus) throw new Error('Skill 审核操作无效');
  if (decision === 'activate' && current.status !== 'candidate') throw new Error('只有候选 Skill 可以启用');
  if (decision === 'reject' && current.status !== 'candidate') throw new Error('只有候选 Skill 可以丢弃');
  if (decision === 'restore' && current.status !== 'archived') throw new Error('只有已归档 Skill 可以恢复');
  const now = timestamp();
  store.updateModule('agentSkills', (items) => items.map((skill) => {
    if (skill.id === current.id) {
      return {
        ...skill,
        status: nextStatus,
        ...(decision === 'restore' ? { replacedById: null } : {}),
        reviewedAt: now,
        updatedAt: now,
      };
    }
    if (decision === 'activate' && current.replacesId && skill.id === current.replacesId) {
      return { ...skill, status: 'archived', replacedById: current.id, reviewedAt: now, updatedAt: now };
    }
    if (decision === 'restore' && current.replacedById && skill.id === current.replacedById && skill.status === 'active') {
      return { ...skill, status: 'archived', replacedById: current.id, reviewedAt: now, updatedAt: now };
    }
    return skill;
  }));
  return listSkills({ includeArchived: true }).find((skill) => skill.id === current.id) || null;
}

function selectRelevantSkills(query, limit = 3) {
  const active = rawSkills().filter((skill) => skill.status === 'active');
  const hasQuery = queryTerms(query).length > 0;
  if (!hasQuery) return [];
  const stats = buildTermStats(active.map((skill) => `${skill.name}\n${skill.description}\n${skill.instructions}`));
  const selected = active
    .map((skill) => ({ skill, score: relevanceScore(query, `${skill.name}\n${skill.description}\n${skill.instructions}`, stats) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => (b.score - a.score) || String(b.skill.lastUsedAt || '').localeCompare(String(a.skill.lastUsedAt || '')))
    .slice(0, limit)
    .map(({ skill }) => skill);
  if (selected.length) {
    const now = timestamp();
    const selectedIds = new Set(selected.map((skill) => skill.id));
    store.updateModule('agentSkills', (skills) => skills.map((skill) => (
      selectedIds.has(skill.id)
        ? { ...skill, usageCount: Number(skill.usageCount || 0) + 1, lastUsedAt: now, updatedAt: now }
        : skill
    )));
    return rawSkills().filter((skill) => selectedIds.has(skill.id));
  }
  return [];
}

function promptContext(query = '') {
  const goals = listGoals()
    .filter((goal) => ['active', 'paused'].includes(goal.status))
    .slice(0, 8)
    .map((goal) => ({
      id: goal.id,
      title: goal.title,
      description: goal.description,
      status: goal.status,
      targetDate: goal.targetDate,
      progress: goal.summary.progress,
      pendingActions: goal.summary.pending,
    }));
  const memoryHits = rankMemories(query, { limit: 6 })
    .map(({ memory, score }) => ({ id: memory.id, kind: memory.kind, content: memory.content, score }));
  const skills = selectRelevantSkills(query, 3);
  return {
    goals,
    memories: memoryHits.map(({ id, kind, content }) => ({ id, kind, content })),
    memoryIds: memoryHits.map((hit) => hit.id),
    memoryHits,
    skills: skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions })),
    skillIds: skills.map((skill) => skill.id),
  };
}

module.exports = {
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  addGoalAction,
  updateGoalAction,
  linkTodo,
  syncTodo,
  markTodoRemoved,
  linkSuggestion,
  syncSuggestion,
  createMemoryCandidate,
  updateMemory,
  listMemories,
  reviewMemory,
  findRelevantMemories,
  rankMemories,
  findSimilarMemories,
  findConflictingMemories,
  isMemoryExpired,
  isMemoryStale,
  normaliseMemoryText,
  flushMemoryUsage,
  createSkillCandidate,
  listSkills,
  reviewSkill,
  selectRelevantSkills,
  promptContext,
};

if (process.env.WORKBENCH_AGENT_STATE_SELF_TEST === '1') {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(`${os.tmpdir()}/workbench-agent-state-self-test-`);
  try {
    store.init(dir);
    const goal = createGoal({ title: '完成项目方案', description: '本周交付项目方案' });
    assert.equal(goal.summary.progress, 0);
    const todo = { id: 'todo-1', title: '完成方案初稿', done: false };
    linkTodo(goal.id, todo);
    assert.equal(getGoal(goal.id).summary.pending, 1);
    syncTodo({ ...todo, done: true });
    assert.equal(getGoal(goal.id).summary.progress, 100);
    const followUp = addGoalAction({ goalId: goal.id, title: '向负责人确认反馈', type: 'follow-up' });
    assert.equal(getGoal(goal.id).summary.progress, 50);
    updateGoalAction(followUp.id, { status: 'completed', outcome: '已收到确认' });
    assert.equal(getGoal(goal.id).summary.progress, 100);
    const completedGoal = updateGoal(goal.id, { status: 'completed', outcome: '项目方案已交付' });
    assert.equal(completedGoal.summary.progress, 100);
    assert.equal(completedGoal.outcome, '项目方案已交付');
    assert.ok(completedGoal.completedAt);
    assert.equal(updateGoal(goal.id, { status: 'archived' }).status, 'archived');
    assert.equal(listGoals().some((item) => item.id === goal.id), false);
    assert.equal(listGoals({ includeArchived: true }).find((item) => item.id === goal.id)?.status, 'archived');
    assert.equal(updateGoal(goal.id, { status: 'active' }).status, 'active');

    const memory = createMemoryCandidate({ content: '汇报时先给结论，再给证据。', kind: 'preference' });
    assert.equal(listMemories()[0].status, 'candidate');
    reviewMemory(memory.id, 'activate');
    assert.equal(findRelevantMemories('帮我整理汇报', 3)[0].id, memory.id);
    const replacement = createMemoryCandidate({ content: '汇报时先给结论、风险与下一步。', kind: 'preference', replacesId: memory.id });
    reviewMemory(replacement.id, 'activate');
    assert.equal(listMemories({ includeArchived: true }).find((item) => item.id === memory.id)?.status, 'archived');
    reviewMemory(memory.id, 'restore');
    assert.equal(listMemories({ includeArchived: true }).find((item) => item.id === memory.id)?.status, 'active');
    assert.equal(listMemories({ includeArchived: true }).find((item) => item.id === replacement.id)?.status, 'archived');

    // 使用统计：命中后累计次数并记录最后使用时间，写入按窗口合并。
    const usageMemory = createMemoryCandidate({ content: '会议记录统一放在备忘录的会议标题下。', kind: 'instruction' });
    reviewMemory(usageMemory.id, 'activate');
    assert.equal(findRelevantMemories('帮我把会议记录整理一下', 3)[0].id, usageMemory.id);
    flushMemoryUsage();
    const touchedUsage = listMemories({ includeArchived: true }).find((item) => item.id === usageMemory.id);
    assert.equal(touchedUsage.usageCount, 1);
    assert.ok(touchedUsage.lastUsedAt);

    // 有效期：过期记忆不再进入上下文，但在列表中仍可被识别与恢复。
    const expiredMemory = createMemoryCandidate({ content: '本季度末要提交绩效自评。', kind: 'fact', validUntil: '2020-01-01T00:00:00.000Z' });
    reviewMemory(expiredMemory.id, 'activate');
    assert.equal(findRelevantMemories('绩效自评什么时候提交', 5).some((item) => item.id === expiredMemory.id), false);
    assert.equal(listMemories({ includeArchived: true }).find((item) => item.id === expiredMemory.id).expired, true);

    // 近似重复：采纳新记忆时取代旧条，而不是让两条相近内容同时生效。
    const oldRule = createMemoryCandidate({ content: '周报要先核对数据再写结论', kind: 'instruction' });
    reviewMemory(oldRule.id, 'activate');
    const newRule = createMemoryCandidate({ content: '周报要先核对数据再写结论，然后发送给负责人', kind: 'instruction' });
    assert.deepEqual(newRule.similarIds, [oldRule.id]);
    reviewMemory(newRule.id, 'activate');
    const superseded = listMemories({ includeArchived: true }).find((item) => item.id === oldRule.id);
    assert.equal(superseded.status, 'archived');
    assert.equal(superseded.replacedById, newRule.id);

    // 容量：超出上限时归档最久未使用的生效记忆（可恢复），而不是静默删除最旧记忆。
    const liveBeforeBulk = listMemories().length;
    for (let index = liveBeforeBulk; index < MAX_MEMORIES + 4; index += 1) {
      const bulk = createMemoryCandidate({ content: `mem-${index}`, kind: 'fact' });
      reviewMemory(bulk.id, 'activate');
    }
    assert.equal(listMemories().length, MAX_MEMORIES);
    const archivedByCapacity = listMemories({ includeArchived: true }).find((item) => item.archivedReason === 'capacity');
    assert.ok(archivedByCapacity);
    assert.equal(archivedByCapacity.status, 'archived');
    reviewMemory(archivedByCapacity.id, 'restore');
    assert.equal(listMemories({ includeArchived: true }).find((item) => item.id === archivedByCapacity.id).status, 'active');

    // 置顶记忆不会因为时间久、用词不同而被挤出上下文。
    const seedMemory = (id, content, extra = {}) => ({
      id,
      content,
      kind: 'fact',
      status: 'active',
      source: 'self-test',
      replacesId: null,
      replacedById: null,
      validUntil: null,
      similarIds: [],
      pinned: false,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      reviewedAt: null,
      ...extra,
    });
    assert.throws(() => reviewMemory('missing-memory-id', 'pin'), /长期记忆不存在/);
    store.setModule('agentMemories', [
      seedMemory('pin-target', '陈年偏好：先做最难的事。', { pinned: true, updatedAt: '2020-01-01T00:00:00.000Z' }),
      ...Array.from({ length: 8 }, (_, index) => seedMemory(`fresh-${index}`, `新记录${index}号`, { updatedAt: `2026-02-0${(index % 9) + 1}T00:00:00.000Z` })),
    ]);
    assert.equal(rankMemories('', { touch: false, limit: 3 })[0].memory.id, 'pin-target');
    assert.equal(rankMemories('完全不相干的检索词', { touch: false, limit: 3 })[0].memory.id, 'pin-target');
    assert.equal(reviewMemory('pin-target', 'unpin')?.pinned, false);
    assert.equal(rankMemories('完全不相干的检索词', { touch: false, limit: 3 }).length, 0);
    assert.equal(reviewMemory('pin-target', 'pin')?.pinned, true);

    // 检索加权：稀有词权重高于常见词，且长内容不会因为篇幅占优。
    const filler = '春雨惊春清谷天夏满芒夏暑相连秋处露秋寒霜降冬雪雪冬小大寒';
    store.setModule('agentMemories', [
      ...Array.from({ length: 6 }, (_, index) => seedMemory(`common-${index}`, `每周同步进度${index}号`)),
      seedMemory('rare-1', '季度复盘要注明结论'),
      seedMemory('long-1', `季度复盘结论${filler}`),
    ]);
    const weighted = rankMemories('进度 复盘', { touch: false, limit: 8 });
    assert.equal(weighted.length, 8);
    assert.equal(weighted[0].memory.id, 'rare-1');
    assert.equal(weighted.at(-1).memory.id, 'long-1');

    // 归一化去重：标点、空格与大小写差异不再产生第二条记忆；内容已生效时直接复用。
    store.setModule('agentMemories', []);
    const firstDraft = createMemoryCandidate({ content: '汇报前先确认结论。', kind: 'instruction' });
    const sameDraft = createMemoryCandidate({ content: ' 汇报前先确认结论！ ', kind: 'instruction' });
    assert.equal(sameDraft.id, firstDraft.id);
    reviewMemory(firstDraft.id, 'activate');
    const reusedActive = createMemoryCandidate({ content: '汇报前先确认结论', kind: 'instruction' });
    assert.equal(reusedActive.id, firstDraft.id);
    assert.equal(reusedActive.status, 'active');

    // 编辑：可以改措辞，状态不变；内容为空或与其它记忆重复会被拒绝。
    const editedMemory = updateMemory(firstDraft.id, '汇报前先把结论写在最前面。');
    assert.equal(editedMemory.content, '汇报前先把结论写在最前面。');
    assert.equal(editedMemory.status, 'active');
    assert.throws(() => updateMemory(firstDraft.id, '   '), /记忆内容不能为空/);
    assert.throws(() => updateMemory('missing-memory', '随便写点什么'), /长期记忆不存在/);
    const secondDraft = createMemoryCandidate({ content: '周报先核对数据。', kind: 'instruction' });
    reviewMemory(secondDraft.id, 'activate');
    assert.throws(() => updateMemory(secondDraft.id, '汇报前先把结论写在最前面'), /已存在内容相同的记忆/);

    // 方向相反：相似度不高但语义相反的表述会被识别为冲突候选，只提示不自动归档。
    store.setModule('agentMemories', [seedMemory('neg-1', '周末安排会议。')]);
    const conflicts = findConflictingMemories('周末不要安排会议。', 'fact');
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].memory.id, 'neg-1');
    assert.equal(findConflictingMemories('周末安排会议。', 'fact').length, 0);

    // 久未使用：只有未置顶、未归档且长期未命中的生效记忆会被标记。
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    store.setModule('agentMemories', [
      seedMemory('stale-1', '很久以前写下的偏好。', { createdAt: daysAgo(400), updatedAt: daysAgo(400) }),
      seedMemory('fresh-1', '最近写下的偏好。', { createdAt: daysAgo(1), updatedAt: daysAgo(1) }),
      seedMemory('pinned-1', '置顶的偏好。', { pinned: true, createdAt: daysAgo(400), updatedAt: daysAgo(400) }),
      seedMemory('archived-1', '已归档的偏好。', { status: 'archived', createdAt: daysAgo(400), updatedAt: daysAgo(400) }),
    ]);
    const staleList = listMemories({ includeArchived: true });
    assert.equal(staleList.find((item) => item.id === 'stale-1').stale, true);
    assert.equal(staleList.find((item) => item.id === 'fresh-1').stale, false);
    assert.equal(staleList.find((item) => item.id === 'pinned-1').stale, false);
    assert.equal(staleList.find((item) => item.id === 'archived-1').stale, false);

    const skill = createSkillCandidate({
      name: '周报整理',
      description: '把本周工作整理为结构化周报。',
      instructions: '1. 读取待办和备忘录。\n2. 归纳成果、风险和下周计划。',
    });
    reviewSkill(skill.id, 'activate');
    assert.equal(selectRelevantSkills('帮我整理本周周报', 1)[0].id, skill.id);
    assert.equal(selectRelevantSkills('', 1).length, 0);
    const replacementSkill = createSkillCandidate({
      name: '周报整理 v2',
      description: '先核对数据再输出周报。',
      instructions: '1. 核对待办状态。\n2. 输出周报。',
      replacesId: skill.id,
    });
    reviewSkill(replacementSkill.id, 'activate');
    reviewSkill(skill.id, 'restore');
    assert.equal(listSkills({ includeArchived: true }).find((item) => item.id === skill.id)?.status, 'active');
    assert.equal(listSkills({ includeArchived: true }).find((item) => item.id === replacementSkill.id)?.status, 'archived');
    console.log('agent state self-test ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
