const crypto = require('node:crypto');
const store = require('./store.cjs');

const MODULE_NAME = 'externalOperations';
const MAX_OPERATIONS = 300;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['prepared', 'executing', 'succeeded', 'unknown']);

function operationError(message, code = '') {
  const error = new Error(message);
  error.exposeToUser = true;
  if (code) error.operationCode = code;
  return error;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .filter((key) => key !== 'operationId')
    .sort()
    .reduce((out, key) => {
      out[key] = canonical(value[key]);
      return out;
    }, {});
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

function normaliseId(value) {
  const id = String(value || '').trim();
  if (!OPERATION_ID.test(id)) throw operationError('操作标识无效或已过期');
  return id;
}

function normaliseKind(value) {
  const kind = String(value || '').trim();
  if (!kind || kind.length > 80) throw operationError('操作类型无效');
  return kind;
}

function list() {
  const items = store.getModule(MODULE_NAME);
  return Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : [];
}

function prepare(kindValue, payload) {
  const kind = normaliseKind(kindValue);
  const now = new Date().toISOString();
  const operation = {
    id: crypto.randomUUID(),
    kind,
    payloadHash: payloadHash(payload),
    status: 'prepared',
    result: null,
    createdAt: now,
    updatedAt: now,
  };
  store.updateModule(MODULE_NAME, (items) => [operation, ...items].slice(0, MAX_OPERATIONS));
  return operation;
}

/**
 * 原子领取一次外部副作用。相同 ID 只能从 prepared 进入 executing 一次；重启遗留的
 * executing 状态视为 unknown，宁可要求核对，也不盲目重放。
 */
function claim(idValue, kindValue, payload) {
  const id = normaliseId(idValue);
  const kind = normaliseKind(kindValue);
  const expectedHash = payloadHash(payload);
  let result = null;
  store.updateModule(MODULE_NAME, (items) => items.map((item) => {
    if (item?.id !== id) return item;
    if (item.kind !== kind || item.payloadHash !== expectedHash) {
      throw operationError('操作内容与原确认不一致，请重新发起确认');
    }
    if (!STATUSES.has(item.status)) {
      throw operationError('操作状态无效，请重新发起确认');
    }
    if (item.status === 'prepared') {
      const next = { ...item, status: 'executing', updatedAt: new Date().toISOString() };
      result = { state: 'execute', operation: next };
      return next;
    }
    if (item.status === 'succeeded') {
      result = { state: 'succeeded', operation: item };
      return item;
    }
    // executing 可能是当前并发请求，也可能是进程在外部调用途中退出后的遗留状态。
    const next = item.status === 'executing'
      ? { ...item, status: 'unknown', updatedAt: new Date().toISOString() }
      : item;
    result = { state: 'unknown', operation: next };
    return next;
  }));
  if (!result) throw operationError('确认操作不存在或已过期，请重新发起');
  return result;
}

function resultForStorage(value) {
  if (value === undefined) return null;
  try {
    const json = JSON.stringify(value);
    // 大型音乐库不能作为幂等账本回执保存，避免把本地状态文件放大。
    return json.length <= 16_000 ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

function succeed(idValue, result) {
  const id = normaliseId(idValue);
  const storedResult = resultForStorage(result);
  let operation = null;
  store.updateModule(MODULE_NAME, (items) => items.map((item) => {
    if (item?.id !== id) return item;
    operation = {
      ...item,
      status: 'succeeded',
      result: storedResult,
      updatedAt: new Date().toISOString(),
    };
    return operation;
  }));
  if (!operation) throw operationError('确认操作不存在或已过期，请重新发起');
  return operation;
}

function markUnknown(idValue) {
  const id = normaliseId(idValue);
  let operation = null;
  store.updateModule(MODULE_NAME, (items) => items.map((item) => {
    if (item?.id !== id) return item;
    operation = { ...item, status: 'unknown', updatedAt: new Date().toISOString() };
    return operation;
  }));
  if (!operation) throw operationError('确认操作不存在或已过期，请重新发起');
  return operation;
}

function unknownOutcome(label) {
  return operationError(`${label}的最终状态无法确认。为避免重复执行，Loom 不会自动重试；请先核对外部服务中的结果，再决定是否重新发起。`, 'unknown');
}

async function execute(id, kind, payload, label, callback, options = {}) {
  const claimed = claim(id, kind, payload);
  if (claimed.state === 'succeeded') return { replayed: true, result: claimed.operation.result };
  if (claimed.state !== 'execute') throw unknownOutcome(label);
  try {
    const result = await callback();
    succeed(id, typeof options.resultForLedger === 'function' ? options.resultForLedger(result) : result);
    return { replayed: false, result };
  } catch (error) {
    markUnknown(id);
    throw unknownOutcome(label);
  }
}

module.exports = {
  prepare,
  claim,
  succeed,
  markUnknown,
  unknownOutcome,
  execute,
  payloadHash,
  list,
};

if (process.env.WORKBENCH_OPERATION_SELF_TEST === '1') {
  void (async () => {
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-operation-self-test-'));
    try {
      store.init(dir);
      const payload = { kind: 'send_email', to: 'candidate@example.com', text: '不应持久化正文' };
      const operation = prepare('mail:send', payload);
      let acceptedThenLostAttempts = 0;
      await assert.rejects(() => execute(operation.id, 'mail:send', payload, '邮件投递', async () => {
        acceptedThenLostAttempts += 1;
        // 模拟 SMTP 已接受 DATA、但成功响应在网络中断中丢失。
        throw new Error('socket closed after remote acceptance');
      }), /最终状态无法确认/);
      assert.equal(acceptedThenLostAttempts, 1);
      await assert.rejects(() => execute(operation.id, 'mail:send', payload, '邮件投递', async () => {
        acceptedThenLostAttempts += 1;
        return { shouldNotRun: true };
      }), /最终状态无法确认/);
      assert.equal(acceptedThenLostAttempts, 1);
      assert.equal(list().find((item) => item.id === operation.id)?.status, 'unknown');
      const completed = prepare('mail:send', payload);
      let successfulAttempts = 0;
      const firstResult = await execute(completed.id, 'mail:send', payload, '邮件投递', async () => {
        successfulAttempts += 1;
        return { accepted: ['candidate@example.com'] };
      });
      const replayResult = await execute(completed.id, 'mail:send', payload, '邮件投递', async () => {
        successfulAttempts += 1;
        return { shouldNotRun: true };
      });
      assert.deepEqual(firstResult, { replayed: false, result: { accepted: ['candidate@example.com'] } });
      assert.deepEqual(replayResult, { replayed: true, result: { accepted: ['candidate@example.com'] } });
      assert.equal(successfulAttempts, 1);
      assert.throws(() => claim(completed.id, 'mail:send', { ...payload, text: '变更正文' }), /内容与原确认不一致/);
      const persisted = fs.readFileSync(path.join(dir, 'workbench-data.json'), 'utf8');
      assert.equal(persisted.includes(payload.text), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log('operation self-test ok');
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
