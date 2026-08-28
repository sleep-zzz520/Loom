const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const crypto = require('node:crypto');
const store = require('./store.cjs');

const SECRET_PREFIX = 'safe-storage:v1:';
const MAX_LIST_LIMIT = 100;
const MAX_MESSAGE_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_AGENT_INBOX_BATCH = 12;
const MAX_AGENT_SOURCE_BYTES = 64 * 1024;
const MAX_AGENT_TEXT_CHARS = 4_000;
const FOLDER_PRIORITY = ['\\Inbox', '\\Sent', '\\Drafts', '\\Flagged', '\\Junk', '\\Trash'];

let safeStorage = null;

function init(options = {}) {
  safeStorage = options.safeStorage || null;
  migrateLegacyPassword();
}

function userError(message) {
  const error = new Error(message);
  error.exposeToUser = true;
  return error;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalisePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw userError(label + '必须是 1 到 65535 之间的整数');
  }
  return port;
}

function normaliseHost(value, label) {
  const host = cleanText(value);
  if (!host || host.length > 255 || /[\s/\\]/.test(host) || host.includes('://')) {
    throw userError(label + '无效，请填写服务器域名或 IP 地址');
  }
  return host;
}

function normaliseUser(value) {
  const user = cleanText(value);
  if (!user || user.length > 320 || /[\r\n]/.test(user)) {
    throw userError('邮箱账号无效');
  }
  return user;
}

function validateAccountInput(input = {}) {
  return {
    host: normaliseHost(input.host, 'IMAP 服务器'),
    port: normalisePort(input.port, 'IMAP 端口'),
    secure: input.secure !== false,
    user: normaliseUser(input.user),
    smtpHost: normaliseHost(input.smtpHost, 'SMTP 服务器'),
    smtpPort: normalisePort(input.smtpPort, 'SMTP 端口'),
    smtpSecure: input.smtpSecure !== false,
  };
}

function getStoredEmail() {
  const email = store.getSettings().email || {};
  return {
    host: cleanText(email.host),
    port: Number.isInteger(email.port) ? email.port : 993,
    secure: email.secure !== false,
    user: cleanText(email.user),
    pass: typeof email.pass === 'string' ? email.pass : '',
    smtpHost: cleanText(email.smtpHost),
    smtpPort: Number.isInteger(email.smtpPort) ? email.smtpPort : 465,
    smtpSecure: email.smtpSecure !== false,
  };
}

function hasEncryptedPassword(value) {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX);
}

function getSafeStorage() {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
    throw userError('系统安全存储不可用，暂时无法保存邮箱授权码');
  }
  return safeStorage;
}

function encryptPassword(password) {
  const encrypted = getSafeStorage().encryptString(password);
  return SECRET_PREFIX + encrypted.toString('base64');
}

function decryptPassword(value) {
  if (!hasEncryptedPassword(value)) {
    throw userError('邮箱授权码需要重新保存后才能使用');
  }
  try {
    return getSafeStorage().decryptString(Buffer.from(value.slice(SECRET_PREFIX.length), 'base64'));
  } catch {
    throw userError('无法读取已保存的邮箱授权码，请重新输入并保存');
  }
}

function migrateLegacyPassword() {
  const email = getStoredEmail();
  if (!email.pass || hasEncryptedPassword(email.pass) || !safeStorage) return;
  try {
    store.setSettings({ email: { ...email, pass: encryptPassword(email.pass) } });
  } catch {
    // 保留旧值，方便用户在系统安全存储恢复后完成迁移。
  }
}

function account() {
  const email = getStoredEmail();
  const hasPassword = hasEncryptedPassword(email.pass);
  const configured = Boolean(
    email.host
      && email.user
      && email.smtpHost
      && hasPassword
      && Number.isInteger(email.port)
      && Number.isInteger(email.smtpPort)
  );
  return {
    host: email.host,
    port: email.port,
    secure: email.secure,
    user: email.user,
    smtpHost: email.smtpHost,
    smtpPort: email.smtpPort,
    smtpSecure: email.smtpSecure,
    hasPassword,
    configured,
  };
}

function saveAccount(input = {}) {
  const next = validateAccountInput(input);
  const current = getStoredEmail();
  const password = typeof input.password === 'string' && input.password.length > 0
    ? encryptPassword(input.password)
    : current.pass;

  if (!hasEncryptedPassword(password)) {
    throw userError('请填写邮箱授权码或应用专用密码');
  }

  store.setSettings({ email: { ...next, pass: password } });
  return account();
}

function connectionConfig(input) {
  const email = getStoredEmail();
  const config = validateAccountInput(input || email);
  // 测试连接可以使用尚未保存的表单值；仅在用户点击保存时才会加密并持久化授权码。
  const password = typeof input?.password === 'string' && input.password.length > 0
    ? input.password
    : decryptPassword(email.pass);
  return { ...config, password };
}

function toMailError(error) {
  if (error?.exposeToUser) return error;
  const message = String(error?.responseText || error?.message || error || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 240);
  if (/auth|login|credential|authentication|invalid user|535/i.test(message)) {
    return userError('邮箱登录失败，请检查邮箱账号、授权码，以及是否已开启 IMAP / SMTP 服务');
  }
  if (/timeout|timed out|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|network/i.test(message)) {
    return userError('无法连接邮箱服务器，请检查服务器地址、端口和网络连接');
  }
  if (/certificate|tls|ssl|self signed/i.test(message)) {
    return userError('邮箱服务器的安全证书验证失败，请确认服务器地址和 TLS 设置');
  }
  return userError(message ? '邮箱服务返回错误：' + message : '邮箱服务暂时不可用');
}

function createImapClient(config) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 30_000,
  });
  client.on('error', () => {});
  return client;
}

async function withImap(callback, config = connectionConfig()) {
  const client = createImapClient(config);
  try {
    await client.connect();
    return await callback(client, config);
  } catch (error) {
    throw toMailError(error);
  } finally {
    try {
      if (client.usable) await client.logout();
      else client.close();
    } catch {
      client.close();
    }
  }
}

function folderName(mailbox) {
  const path = String(mailbox.path || '');
  const delimiter = String(mailbox.delimiter || '');
  if (!delimiter) return path;
  return path.split(delimiter).filter(Boolean).pop() || path;
}

function folderPriority(folder) {
  const specialUse = folder.specialUse || '';
  const specialIndex = FOLDER_PRIORITY.indexOf(specialUse);
  if (specialIndex >= 0) return specialIndex;
  return FOLDER_PRIORITY.length + 1;
}

async function getFolders(client) {
  const mailboxes = await client.list();
  return mailboxes
    .filter((mailbox) => !mailbox.flags?.has('\\Noselect'))
    .map((mailbox) => ({
      path: String(mailbox.path || ''),
      name: folderName(mailbox),
      specialUse: mailbox.specialUse || null,
    }))
    .filter((folder) => folder.path)
    .sort((left, right) => {
      const priority = folderPriority(left) - folderPriority(right);
      return priority || left.name.localeCompare(right.name, 'zh-CN');
    });
}

function selectFolder(folders, requestedFolder) {
  const inbox = folders.find((folder) => folder.specialUse === '\\Inbox')
    || folders.find((folder) => folder.path.toUpperCase() === 'INBOX');
  if (!requestedFolder) return inbox?.path || folders[0]?.path || 'INBOX';
  const requested = folders.find((folder) => folder.path === requestedFolder);
  if (!requested) throw userError('所选邮箱文件夹不存在，请先刷新邮箱');
  return requested.path;
}

function normaliseLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit)) return 50;
  return Math.max(1, Math.min(MAX_LIST_LIMIT, limit));
}

function recentMessageSequence(total, limit) {
  if (!Number.isInteger(total) || total <= 0) return null;
  return Math.max(1, total - limit + 1) + ':*';
}

function normaliseAddresses(addresses) {
  if (!Array.isArray(addresses)) return [];
  return addresses
    .map((item) => ({
      name: cleanText(item?.name),
      address: cleanText(item?.address),
    }))
    .filter((item) => item.name || item.address);
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function messageSummary(message, folder) {
  const envelope = message.envelope || {};
  return {
    uid: Number(message.uid),
    folder,
    from: normaliseAddresses(envelope.from),
    to: normaliseAddresses(envelope.to),
    subject: cleanText(envelope.subject) || '（无主题）',
    date: toIsoDate(envelope.date) || toIsoDate(message.internalDate),
    receivedAt: toIsoDate(message.internalDate) || toIsoDate(envelope.date),
    size: Number(message.size) || 0,
    seen: Boolean(message.flags?.has('\\Seen')),
  };
}

async function listMailbox(requestedFolder = '', requestedLimit = 50) {
  const limit = normaliseLimit(requestedLimit);
  return withImap(async (client) => {
    const folders = await getFolders(client);
    const folder = selectFolder(folders, requestedFolder);
    const status = await client.status(folder, { messages: true, unseen: true });
    const lock = await client.getMailboxLock(folder);
    try {
      const total = Number(status.messages ?? client.mailbox?.exists ?? 0);
      const unseen = Number(status.unseen ?? 0);
      const sequence = recentMessageSequence(total, limit);
      const fetched = sequence
        ? await client.fetchAll(sequence, {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
          size: true,
        })
        : [];
      const messages = fetched
        .map((message) => messageSummary(message, folder))
        .sort((left, right) => {
          const rightTime = new Date(right.receivedAt || right.date || 0).getTime();
          const leftTime = new Date(left.receivedAt || left.date || 0).getTime();
          return rightTime - leftTime || right.uid - left.uid;
        });
      return { account: account(), folders, folder, messages, total, unseen };
    } finally {
      lock.release();
    }
  });
}

function normaliseAgentText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_AGENT_TEXT_CHARS);
}

function mailboxUidValidity(mailbox) {
  const value = Number(mailbox?.uidValidity);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function isLikelyPromotional(summary, text = '', listUnsubscribe = '') {
  const haystack = [
    summary.subject,
    ...(summary.from || []).map((address) => `${address.name} ${address.address}`),
    text,
    listUnsubscribe,
  ].join('\n').toLowerCase();
  // 招聘/面试等信号优先于群发或 no-reply 特征，避免漏掉招聘平台的系统邮件。
  const careerSignal = /(招聘|应聘|候选人|简历|面试|笔试|测评|offer|录用|校招|internship|interview|recruit(?:ment|er)?|application|candidate)/i.test(haystack);
  const promotionSignal = /(退订|取消订阅|unsubscribe|newsletter|营销|推广|促销|优惠|折扣|限时|会员专享|优惠券|广告|sale\b|deal\b|campaign)/i.test(haystack);
  return promotionSignal && !careerSignal;
}

async function agentInboxPreview(message, folder) {
  const summary = messageSummary(message, folder);
  let text = '';
  let listUnsubscribe = '';
  if (message.source?.length) {
    try {
      const parsed = await simpleParser(message.source);
      text = normaliseAgentText(parsed.text);
      listUnsubscribe = String(parsed.headers?.get('list-unsubscribe') || '');
    } catch {
      // 解析失败时仅使用可信的信封信息；不让一封异常邮件阻塞后续收件检查。
    }
  }
  return {
    ...summary,
    text,
    locallyFiltered: isLikelyPromotional(summary, text, listUnsubscribe),
  };
}

/**
 * 返回指定 UID 游标之后的一小批 Inbox 邮件，供 Agent 做重要性判断。
 * 首次调用只建立游标，不回溯整箱旧邮件，避免首次启用时制造通知风暴。
 */
async function listInboxForAgent(afterUid = null, requestedLimit = MAX_AGENT_INBOX_BATCH) {
  const limit = Math.max(1, Math.min(MAX_AGENT_INBOX_BATCH, Number(requestedLimit) || MAX_AGENT_INBOX_BATCH));
  const cursor = Number(afterUid);
  const hasCursor = Number.isSafeInteger(cursor) && cursor >= 0;
  return withImap(async (client) => {
    const folders = await getFolders(client);
    const folder = selectFolder(folders, '');
    const lock = await client.getMailboxLock(folder);
    try {
      const uidValidity = mailboxUidValidity(client.mailbox);
      if (!hasCursor) {
        const latest = await client.fetchOne('*', { uid: true });
        return {
          folder,
          uidValidity,
          initialized: true,
          nextUid: Number(latest?.uid) || 0,
          hasMore: false,
          messages: [],
        };
      }
      const uids = await client.search({ uid: `${cursor + 1}:*` }, { uid: true });
      const pending = [...new Set(uids.map(Number).filter((uid) => Number.isSafeInteger(uid) && uid > cursor))]
        .sort((left, right) => left - right);
      const selected = pending.slice(0, limit);
      if (!selected.length) {
        return { folder, uidValidity, initialized: false, nextUid: cursor, hasMore: false, messages: [] };
      }
      const fetched = await client.fetchAll(selected, {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        size: true,
        // 只取开头，足够覆盖常见主题、发件人和行动说明，也避免把大附件或整封长邮件交给模型。
        source: { start: 0, maxLength: MAX_AGENT_SOURCE_BYTES },
      }, { uid: true });
      const messages = await Promise.all(fetched
        .sort((left, right) => Number(left.uid) - Number(right.uid))
        .map((message) => agentInboxPreview(message, folder)));
      return {
        folder,
        uidValidity,
        initialized: false,
        nextUid: selected.at(-1),
        hasMore: pending.length > selected.length,
        messages,
      };
    } finally {
      lock.release();
    }
  });
}

function normaliseAttachment(attachment) {
  return {
    filename: cleanText(attachment?.filename) || '未命名附件',
    contentType: cleanText(attachment?.contentType) || 'application/octet-stream',
    size: Number(attachment?.size || attachment?.content?.length || 0),
  };
}

function normaliseHtmlBody(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normaliseContentId(value) {
  return String(value || '').trim().replace(/^<|>$/g, '');
}

function embedRelatedImages(html, attachments) {
  if (!html) return '';

  const inlineImages = new Map();
  for (const attachment of attachments || []) {
    const cid = normaliseContentId(attachment?.cid || attachment?.contentId);
    const contentType = cleanText(attachment?.contentType).toLowerCase();
    if (!cid || !/^image\/[a-z0-9.+-]+$/i.test(contentType) || !Buffer.isBuffer(attachment?.content)) continue;
    inlineImages.set(cid, 'data:' + contentType + ';base64,' + attachment.content.toString('base64'));
  }

  return html.replace(/\bcid:([^'"\s)<>]+)/gi, (match, cid) => inlineImages.get(normaliseContentId(cid)) || match);
}

function messageTooLargeText(size) {
  const megabytes = (size / 1024 / 1024).toFixed(1);
  return '这封邮件约 ' + megabytes + ' MB，当前版本为保护本地内存仅展示主题和邮件头。';
}

async function getMessage(requestedFolder, rawUid) {
  const uid = Number(rawUid);
  if (!Number.isInteger(uid) || uid <= 0) throw userError('邮件标识无效');
  return withImap(async (client) => {
    const folders = await getFolders(client);
    const folder = selectFolder(folders, requestedFolder);
    const lock = await client.getMailboxLock(folder);
    try {
      const metadata = await client.fetchOne(String(uid), {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        size: true,
      }, { uid: true });
      if (!metadata) throw userError('未找到这封邮件，它可能已被移动或删除');

      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      const summary = { ...messageSummary(metadata, folder), seen: true };
      // ponytail: 正文源限制为 2 MB；需要完整大邮件阅读或附件下载时，改为基于 IMAP 流与 MailParser 流式解析。
      if (summary.size > MAX_MESSAGE_SOURCE_BYTES) {
        return {
          ...summary,
          cc: normaliseAddresses(metadata.envelope?.cc),
          replyTo: normaliseAddresses(metadata.envelope?.replyTo),
          messageId: cleanText(metadata.envelope?.messageId) || null,
          inReplyTo: cleanText(metadata.envelope?.inReplyTo) || null,
          text: messageTooLargeText(summary.size),
          html: '',
          bodyUnavailable: true,
          attachments: [],
        };
      }

      const fetched = await client.fetchOne(String(uid), {
        source: true,
      }, { uid: true });
      if (!fetched?.source) throw userError('无法读取邮件正文');
      const parsed = await simpleParser(fetched.source);
      const attachments = (parsed.attachments || [])
        .filter((item) => !item.related)
        .map(normaliseAttachment);
      return {
        ...summary,
        cc: normaliseAddresses(parsed.cc?.value || metadata.envelope?.cc),
        replyTo: normaliseAddresses(parsed.replyTo?.value || metadata.envelope?.replyTo),
        messageId: cleanText(parsed.messageId || metadata.envelope?.messageId) || null,
        inReplyTo: cleanText(parsed.inReplyTo || metadata.envelope?.inReplyTo) || null,
        text: String(parsed.text || '此邮件没有可显示的纯文本正文。').trim() || '此邮件没有可显示的纯文本正文。',
        html: embedRelatedImages(normaliseHtmlBody(parsed.html), parsed.attachments),
        bodyUnavailable: false,
        attachments,
      };
    } finally {
      lock.release();
    }
  });
}

async function markRead(requestedFolder, rawUid) {
  const uid = Number(rawUid);
  if (!Number.isInteger(uid) || uid <= 0) throw userError('邮件标识无效');
  return withImap(async (client) => {
    const folders = await getFolders(client);
    const folder = selectFolder(folders, requestedFolder);
    const lock = await client.getMailboxLock(folder);
    try {
      const changed = await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      if (!changed) throw userError('无法更新邮件已读状态');
      return { folder, uid };
    } finally {
      lock.release();
    }
  });
}

function createSmtpTransport(config) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 30_000,
  });
}

async function verifyConnection(input) {
  const result = { imap: false, smtp: false, imapError: '', smtpError: '' };
  let config;
  try {
    config = connectionConfig(input);
    await withImap(async () => {}, config);
    result.imap = true;
  } catch (error) {
    result.imapError = toMailError(error).message;
  }

  let transport = null;
  try {
    config ||= connectionConfig(input);
    transport = createSmtpTransport(config);
    await transport.verify();
    result.smtp = true;
  } catch (error) {
    result.smtpError = toMailError(error).message;
  } finally {
    transport?.close();
  }
  return result;
}

function addressList(value, label, required = false) {
  const addresses = String(value || '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (required && !addresses.length) throw userError('请填写' + label);
  for (const address of addresses) {
    if (address.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      throw userError(label + '中包含无效邮箱地址');
    }
  }
  return addresses;
}

function normaliseSubject(value) {
  const subject = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  if (subject.length > 500) throw userError('邮件主题不能超过 500 个字符');
  return subject;
}

function normaliseBody(value) {
  const text = String(value || '');
  if (text.length > 1_000_000) throw userError('邮件正文不能超过 100 万个字符');
  return text;
}

function normaliseMessageId(value) {
  const messageId = cleanText(value);
  if (!messageId) return '';
  if (messageId.length > 998 || /[\r\n]/.test(messageId)) {
    throw userError('回复关联标识无效');
  }
  return messageId;
}

function smtpReceipt(result = {}) {
  const accepted = Array.isArray(result.accepted)
    ? result.accepted.map((value) => cleanText(String(value))).filter(Boolean)
    : [];
  const rejected = Array.isArray(result.rejected)
    ? result.rejected.map((value) => cleanText(String(value))).filter(Boolean)
    : [];
  if (!accepted.length) {
    throw userError(rejected.length
      ? '发件服务器未接受收件人：' + rejected.join('、')
      : '发件服务器没有确认接受任何收件人，请稍后重试');
  }
  return {
    messageId: cleanText(String(result.messageId || '')),
    accepted,
    rejected,
    response: cleanText(String(result.response || '')).slice(0, 240),
    deliveryId: cleanText(String(result.deliveryId || '')),
    dsnSupported: Array.isArray(result.ehlo) && result.ehlo.some((line) => /^DSN\b/i.test(String(line || '').trim())),
  };
}

async function sendMessage(input = {}) {
  const config = connectionConfig();
  const to = addressList(input.to, '收件人', true);
  const cc = addressList(input.cc, '抄送');
  const subject = normaliseSubject(input.subject);
  const text = normaliseBody(input.text);
  const inReplyTo = normaliseMessageId(input.inReplyTo);
  const deliveryId = 'loom-' + crypto.randomUUID();
  const transport = createSmtpTransport(config);
  try {
    const result = await transport.sendMail({
      from: config.user,
      to,
      ...(cc.length ? { cc } : {}),
      ...(inReplyTo ? { inReplyTo } : {}),
      subject,
      text,
      // DSN 是可选 SMTP 扩展：服务器未声明 DSN 时 Nodemailer 会正常发送，但无法获得后续失败/延迟回执。
      dsn: {
        id: deliveryId,
        return: 'headers',
        notify: ['failure', 'delay'],
      },
      headers: {
        'X-Loom-Delivery-Id': deliveryId,
      },
    });
    return smtpReceipt({ ...result, deliveryId });
  } catch (error) {
    throw toMailError(error);
  } finally {
    transport.close();
  }
}

module.exports = {
  init,
  account,
  saveAccount,
  verifyConnection,
  listMailbox,
  listInboxForAgent,
  getMessage,
  markRead,
  sendMessage,
  validateAccountInput,
  addressList,
  smtpReceipt,
  messageSummary,
  isLikelyPromotional,
};

if (process.env.WORKBENCH_MAIL_SELF_TEST === '1') {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const config = validateAccountInput({
    host: 'imap.example.com',
    port: 993,
    secure: true,
    user: 'me@example.com',
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecure: true,
  });
  assert.equal(config.host, 'imap.example.com');
  assert.equal(config.smtpPort, 465);
  assert.throws(() => validateAccountInput({ ...config, port: 70000 }), /IMAP 端口/);
  assert.deepEqual(addressList('a@example.com; b@example.com', '收件人', true), ['a@example.com', 'b@example.com']);
  assert.throws(() => addressList('not-an-address', '收件人', true), /无效/);
  assert.deepEqual(smtpReceipt({
    messageId: '<mail@example.com>',
    accepted: ['recipient@example.com'],
    rejected: [],
    response: '250 2.0.0 queued',
    deliveryId: 'loom-example',
    ehlo: ['PIPELINING', 'DSN'],
  }), {
    messageId: '<mail@example.com>',
    accepted: ['recipient@example.com'],
    rejected: [],
    response: '250 2.0.0 queued',
    deliveryId: 'loom-example',
    dsnSupported: true,
  });
  assert.throws(() => smtpReceipt({ accepted: [], rejected: ['missing@example.com'] }), /未接受收件人/);
  const summary = messageSummary({
    uid: 42,
    envelope: {
      subject: '测试邮件',
      from: [{ name: '发件人', address: 'from@example.com' }],
      to: [{ address: 'me@example.com' }],
      date: new Date('2026-08-24T10:00:00.000Z'),
    },
    flags: new Set(),
    internalDate: new Date('2026-08-24T10:01:00.000Z'),
    size: 128,
  }, 'INBOX');
  assert.equal(summary.uid, 42);
  assert.equal(summary.seen, false);
  assert.equal(summary.subject, '测试邮件');
  assert.equal(summary.from[0].address, 'from@example.com');
  assert.equal(isLikelyPromotional({ subject: '限时优惠，点击领取优惠券', from: [] }), true);
  assert.equal(isLikelyPromotional({ subject: '面试邀请：请确认时间', from: [] }, '本周有招聘面试安排，点击确认。'), false);
  assert.equal(normaliseHtmlBody('<p>富文本正文</p>'), '<p>富文本正文</p>');
  assert.equal(normaliseHtmlBody(false), '');
  const embeddedHtml = embedRelatedImages('<img src="cid:banner@example.com">', [{
    cid: '<banner@example.com>',
    contentType: 'image/svg+xml',
    content: Buffer.from('<svg/>'),
  }]);
  assert.match(embeddedHtml, /^<img src="data:image\/svg\+xml;base64,/);
  assert.match(embedRelatedImages('<img src="cid:missing@example.com">', []), /cid:missing@example\.com/);
  assert.equal(recentMessageSequence(0, 50), null);
  assert.equal(recentMessageSequence(1, 50), '1:*');
  assert.equal(recentMessageSequence(50, 50), '1:*');
  assert.equal(recentMessageSequence(51, 50), '2:*');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-mail-self-test-'));
  try {
    store.init(tempDir);
    init({
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from('sealed:' + value),
        decryptString: (value) => value.toString().replace(/^sealed:/, ''),
      },
    });
    const saved = saveAccount({ ...config, password: 'app-token' });
    assert.equal(saved.hasPassword, true);
    assert.equal(saved.configured, true);
    assert.match(store.getSettings().email.pass, /^safe-storage:v1:/);
    assert.notEqual(store.getSettings().email.pass, 'app-token');
    const savedPassword = store.getSettings().email.pass;
    const preview = connectionConfig({
      ...config,
      user: 'draft@example.com',
      password: 'draft-token',
    });
    assert.equal(preview.user, 'draft@example.com');
    assert.equal(preview.password, 'draft-token');
    assert.equal(store.getSettings().email.pass, savedPassword);
    assert.equal(connectionConfig({ ...config, password: '' }).password, 'app-token');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log('mail self-test ok');
}
