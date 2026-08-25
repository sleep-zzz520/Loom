const store = require('./store.cjs');

const MAX_GOALS = 60;
const MAX_ACTIONS = 240;
const MAX_MEMORIES = 120;
const MAX_SKILLS = 60;

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
  const duplicate = rawMemories().find((memory) => memory.status === 'candidate' && memory.content === content && memory.kind === kind);
  if (duplicate) return duplicate;
  const now = timestamp();
  const memory = {
    id: store.newId(),
    content,
    kind,
    status: 'candidate',
    source: safeText(input.source, 60) || 'agent',
    replacesId,
    replacedById: null,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
  };
  store.updateModule('agentMemories', (items) => [memory, ...items].slice(0, MAX_MEMORIES));
  return memory;
}

function listMemories({ includeArchived = false } = {}) {
  const rank = { candidate: 0, active: 1, rejected: 2, archived: 3 };
  return rawMemories()
    .filter((memory) => includeArchived || !['rejected', 'archived'].includes(memory.status))
    .sort((a, b) => (rank[a.status] - rank[b.status]) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function reviewMemory(id, decision) {
  const memoryId = safeText(id, 120);
  const current = rawMemories().find((memory) => memory.id === memoryId);
  if (!current) throw new Error('长期记忆不存在');
  const nextStatus = ({ activate: 'active', reject: 'rejected', archive: 'archived', restore: 'active' })[decision];
  if (!nextStatus) throw new Error('记忆审核操作无效');
  if (decision === 'activate' && current.status !== 'candidate') throw new Error('只有候选记忆可以采纳');
  if (decision === 'reject' && current.status !== 'candidate') throw new Error('只有候选记忆可以丢弃');
  if (decision === 'restore' && current.status !== 'archived') throw new Error('只有已归档记忆可以恢复');
  const now = timestamp();
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
    if (decision === 'activate' && current.replacesId && memory.id === current.replacesId) {
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

function relevanceScore(query, value) {
  const terms = queryTerms(query);
  if (!terms.length) return 0;
  const text = safeText(value, 6000).toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? (term.length > 2 ? 3 : 1) : 0), 0);
}

function findRelevantMemories(query, limit = 6) {
  const active = rawMemories().filter((memory) => memory.status === 'active');
  const hasQuery = queryTerms(query).length > 0;
  return active
    .map((memory) => ({ memory, score: relevanceScore(query, memory.content) }))
    .filter(({ score }) => !hasQuery || score > 0)
    .sort((a, b) => (b.score - a.score) || String(b.memory.updatedAt).localeCompare(String(a.memory.updatedAt)))
    .slice(0, limit)
    .map(({ memory }) => memory);
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
  const selected = active
    .map((skill) => ({ skill, score: relevanceScore(query, `${skill.name}\n${skill.description}\n${skill.instructions}`) }))
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
  return {
    goals,
    memories: findRelevantMemories(query, 6).map((memory) => ({ id: memory.id, kind: memory.kind, content: memory.content })),
    skills: selectRelevantSkills(query, 3).map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions })),
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
  listMemories,
  reviewMemory,
  findRelevantMemories,
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
