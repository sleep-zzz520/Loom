import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import DOMPurify from 'dompurify';
import {
  CheckCircle2,
  CircleAlert,
  Folder,
  Inbox,
  LoaderCircle,
  Mail,
  Paperclip,
  PanelLeftOpen,
  PanelRightClose,
  PenLine,
  RefreshCw,
  Reply,
  Send,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  MailAccount,
  MailAccountInput,
  MailAddress,
  MailConnectionStatus,
  MailFolder,
  MailMessage,
  MailSendResult,
  MailSummary,
  MailboxResult,
} from '../types';

type AccountForm = Omit<MailAccountInput, 'password'> & { password: string };

type ComposerForm = {
  to: string;
  cc: string;
  subject: string;
  text: string;
  inReplyTo?: string;
};

const FOLDER_LABELS: Record<string, string> = {
  '\\Inbox': '收件箱',
  '\\Sent': '已发送',
  '\\Drafts': '草稿',
  '\\Flagged': '已标记',
  '\\Junk': '垃圾邮件',
  '\\Trash': '废纸篓',
};

function accountFormFor(account: MailAccount | null): AccountForm {
  return {
    host: account?.host || '',
    port: account?.port || 993,
    secure: account?.secure ?? true,
    user: account?.user || '',
    smtpHost: account?.smtpHost || '',
    smtpPort: account?.smtpPort || 465,
    smtpSecure: account?.smtpSecure ?? true,
    password: '',
  };
}

function emptyComposer(): ComposerForm {
  return { to: '', cc: '', subject: '', text: '' };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '操作未完成，请稍后重试';
}

function addressesText(addresses: MailAddress[], fallback = '未知发件人') {
  const text = addresses
    .map((item) => {
      if (item.name && item.address) return item.name + ' <' + item.address + '>';
      return item.name || item.address;
    })
    .filter(Boolean)
    .join(', ');
  return text || fallback;
}

function personLabel(addresses: MailAddress[]) {
  const first = addresses[0];
  return first?.name || first?.address || '未知';
}

function folderLabel(folder: MailFolder) {
  return folder.specialUse ? FOLDER_LABELS[folder.specialUse] || folder.name : folder.name;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
    }).format(date);
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

function formatDateTime(value: string | null) {
  if (!value) return '未提供时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未提供时间';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / 1024 / 1024).toFixed(1) + ' MB';
}

const UNSAFE_EMAIL_ELEMENTS = 'base, embed, form, frame, frameset, iframe, input, link, meta, object, script, select, svg, textarea, video, audio, canvas';
const SAFE_EMAIL_IMAGE_SOURCE = /^(?:https?:\/\/|data:image\/[a-z0-9.+-]+;base64,)/i;
const FORBIDDEN_EMAIL_TAGS = ['base', 'embed', 'form', 'frame', 'frameset', 'iframe', 'input', 'link', 'meta', 'object', 'script', 'select', 'svg', 'textarea', 'video', 'audio', 'canvas'];

function safeEmailDocument(html: string) {
  const cleanHtml = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_EMAIL_TAGS,
    FORBID_ATTR: ['target'],
    SANITIZE_NAMED_PROPS: true,
  });
  const parsed = new DOMParser().parseFromString(cleanHtml, 'text/html');
  parsed.querySelectorAll(UNSAFE_EMAIL_ELEMENTS).forEach((element) => element.remove());
  parsed.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'href' || name === 'target') {
        element.removeAttribute(attribute.name);
      } else if (name === 'src' && (element.tagName !== 'IMG' || !SAFE_EMAIL_IMAGE_SOURCE.test(attribute.value))) {
        element.removeAttribute(attribute.name);
      } else if (name === 'srcset' && element.tagName !== 'IMG') {
        element.removeAttribute(attribute.name);
      } else if (name === 'background' && !SAFE_EMAIL_IMAGE_SOURCE.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  const emailHeadStyles = Array.from(parsed.head.querySelectorAll('style'))
    .map((element) => element.outerHTML)
    .join('');

  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: http: data:; style-src \'unsafe-inline\' https: http:; font-src https: http: data:; media-src \'none\'; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\';"><style>html{color:#475569;background:#fff}body{margin:0;padding:0;overflow-wrap:anywhere}img{max-width:100%!important;height:auto!important}table{max-width:100%!important}pre{white-space:pre-wrap}</style>' + emailHeadStyles + '</head>' + parsed.body.outerHTML + '</html>';
}

function accountStatusText(status: MailConnectionStatus) {
  const parts: string[] = [];
  parts.push(status.imap ? 'IMAP 收信已连接' : 'IMAP 收信未连接');
  parts.push(status.smtp ? 'SMTP 发信已连接' : 'SMTP 发信未连接');
  return parts.join(' · ');
}

function sendStatusText(result: MailSendResult) {
  const accepted = result.accepted.join('、');
  if (result.rejected.length) {
    return `发件服务器已接受：${accepted}；未接受：${result.rejected.join('、')}。`;
  }
  const deliveryNotice = result.dsnSupported
    ? '已请求失败或延迟的投递回执。'
    : '发件服务器不支持下游投递回执。';
  return `发件服务器已接受收件人：${accepted}。${deliveryNotice}对方邮箱的后续投递可能仍需一点时间。`;
}

export default function MailModule() {
  const [account, setAccount] = useState<MailAccount | null>(null);
  const [accountForm, setAccountForm] = useState<AccountForm>(() => accountFormFor(null));
  const [mailbox, setMailbox] = useState<MailboxResult | null>(null);
  const [activeFolder, setActiveFolder] = useState('');
  const [selectedSummary, setSelectedSummary] = useState<MailSummary | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<MailMessage | null>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerForm>(() => emptyComposer());
  const [loadingMailbox, setLoadingMailbox] = useState(false);
  const [openingMessage, setOpeningMessage] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendOperationId, setSendOperationId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<MailConnectionStatus | null>(null);
  const [mailboxError, setMailboxError] = useState('');
  const [messageError, setMessageError] = useState('');
  const [setupMessage, setSetupMessage] = useState('');
  const [composerError, setComposerError] = useState('');
  const [composerStatus, setComposerStatus] = useState('');
  const requestRef = useRef(0);

  const refreshMailbox = useCallback(async (folder = '') => {
    setLoadingMailbox(true);
    setMailboxError('');
    try {
      const next = await window.workbench.mail.list(folder, 50);
      setMailbox(next);
      setAccount(next.account);
      setAccountForm((current) => ({ ...accountFormFor(next.account), password: current.password }));
      setActiveFolder(next.folder);
      setSelectedSummary((current) => {
        if (!current || current.folder !== next.folder) return null;
        return next.messages.some((item) => item.uid === current.uid) ? current : null;
      });
      setSelectedMessage((current) => {
        if (!current || current.folder !== next.folder) return null;
        return next.messages.some((item) => item.uid === current.uid) ? current : null;
      });
    } catch (error) {
      setMailboxError(errorText(error));
    } finally {
      setLoadingMailbox(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    window.workbench.mail.account()
      .then((next) => {
        if (!alive) return;
        setAccount(next);
        setAccountForm(accountFormFor(next));
        if (next.configured) void refreshMailbox();
      })
      .catch((error) => {
        if (alive) setMailboxError(errorText(error));
      });
    return () => {
      alive = false;
    };
  }, [refreshMailbox]);

  async function saveAccount(event: FormEvent) {
    event.preventDefault();
    setSavingAccount(true);
    setSetupMessage('');
    setMailboxError('');
    try {
      const next = await window.workbench.mail.saveAccount(accountForm);
      setAccount(next);
      setAccountForm(accountFormFor(next));
      setSetupMessage('账户已保存。正在检查收信和发信连接…');
      setSettingsOpen(false);
      await testConnection(true);
    } catch (error) {
      setSetupMessage(errorText(error));
    } finally {
      setSavingAccount(false);
    }
  }

  async function testConnection(loadAfterSuccess = false) {
    setTestingConnection(true);
    setConnectionStatus(null);
    setSetupMessage('');
    try {
      const result = await window.workbench.mail.verify(accountForm);
      setConnectionStatus(result);
      if (result.imap && loadAfterSuccess) {
        await refreshMailbox('');
      }
    } catch (error) {
      setSetupMessage(errorText(error));
    } finally {
      setTestingConnection(false);
    }
  }

  async function openMessage(summary: MailSummary) {
    const currentRequest = requestRef.current + 1;
    requestRef.current = currentRequest;
    setFoldersOpen(false);
    setSelectedSummary(summary);
    setSelectedMessage(null);
    setOpeningMessage(true);
    setMessageError('');
    try {
      const next = await window.workbench.mail.getMessage(summary.folder, summary.uid);
      if (requestRef.current !== currentRequest) return;
      setSelectedMessage(next);
      setMailbox((current) => {
        if (!current || current.folder !== summary.folder) return current;
        return {
          ...current,
          unseen: summary.seen ? current.unseen : Math.max(0, current.unseen - 1),
          messages: current.messages.map((item) => (
            item.uid === summary.uid ? { ...item, seen: true } : item
          )),
        };
      });
    } catch (error) {
      if (requestRef.current === currentRequest) setMessageError(errorText(error));
    } finally {
      if (requestRef.current === currentRequest) setOpeningMessage(false);
    }
  }

  function selectFolder(path: string) {
    setFoldersOpen(false);
    if (path === activeFolder && mailbox) {
      void refreshMailbox(path);
      return;
    }
    requestRef.current += 1;
    setActiveFolder(path);
    setSelectedSummary(null);
    setSelectedMessage(null);
    setMessageError('');
    void refreshMailbox(path);
  }

  function closeReader() {
    requestRef.current += 1;
    setFoldersOpen(false);
    setSelectedSummary(null);
    setSelectedMessage(null);
    setOpeningMessage(false);
    setMessageError('');
  }

  function startReply() {
    const message = selectedMessage;
    if (!message) return;
    const recipients = message.replyTo.length ? message.replyTo : message.from;
    const subject = message.subject.startsWith('Re:') ? message.subject : 'Re: ' + message.subject;
    setComposer({
      to: recipients.map((item) => item.address).filter(Boolean).join(', '),
      cc: '',
      subject,
      text: '',
      inReplyTo: message.messageId || undefined,
    });
    setSendOperationId(null);
    setComposerError('');
    setComposerStatus('');
    setComposerOpen(true);
  }

  async function sendMail(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setComposerError('');
    setComposerStatus('');
    try {
      const operationId = sendOperationId || (await window.workbench.mail.prepareSend(composer)).operationId;
      setSendOperationId(operationId);
      const result = await window.workbench.mail.send(composer, operationId);
      setComposerStatus(sendStatusText(result));
      setComposer(emptyComposer());
      setSendOperationId(null);
    } catch (error) {
      setComposerError(errorText(error));
    } finally {
      setSending(false);
    }
  }

  const setupVisible = !account?.configured || settingsOpen;
  const folders = mailbox?.folders || [];
  const messages = mailbox?.messages || [];
  const reader = selectedMessage || selectedSummary;

  return (
    <section className={'mail-page' + (setupVisible ? ' is-setup-open' : '')}>

      {setupVisible && (
        <form className="mail-account-card" onSubmit={saveAccount}>
          <div className="mail-account-card-head">
            <div>
              <span className="mail-section-kicker"><ShieldCheck size={14} />安全连接</span>
              <h3>{account?.configured ? '更新邮箱账户' : '连接你的邮箱'}</h3>
              <p>使用 IMAP 收信、SMTP 发信。请填写服务商提供的授权码或应用专用密码，而不是网页登录密码。</p>
            </div>
            {account?.configured && (
              <button type="button" className="mail-close-settings" onClick={() => setSettingsOpen(false)} aria-label="关闭账户设置">
                <X size={17} />
              </button>
            )}
          </div>

          <div className="mail-account-grid">
            <label className="mail-field mail-field-wide">
              <span>邮箱账号</span>
              <input
                type="email"
                value={accountForm.user}
                onChange={(event) => setAccountForm((current) => ({ ...current, user: event.target.value }))}
                placeholder="name@example.com"
                autoComplete="username"
                required
              />
            </label>
            <label className="mail-field mail-field-wide">
              <span>授权码 / 应用专用密码</span>
              <input
                type="password"
                value={accountForm.password}
                onChange={(event) => setAccountForm((current) => ({ ...current, password: event.target.value }))}
                placeholder={account?.hasPassword ? '留空则保留已保存的授权码' : '填写服务商提供的授权码'}
                autoComplete="current-password"
              />
              <small>密码只在保存时提交，随后由系统安全存储加密，页面不会再次读取。</small>
            </label>
            <label className="mail-field">
              <span>IMAP 服务器</span>
              <input
                value={accountForm.host}
                onChange={(event) => setAccountForm((current) => ({ ...current, host: event.target.value }))}
                placeholder="imap.example.com"
                required
              />
            </label>
            <label className="mail-field">
              <span>IMAP 端口</span>
              <input
                type="number"
                min="1"
                max="65535"
                value={accountForm.port}
                onChange={(event) => setAccountForm((current) => ({ ...current, port: Number(event.target.value) }))}
                required
              />
            </label>
            <label className="mail-field">
              <span>SMTP 服务器</span>
              <input
                value={accountForm.smtpHost}
                onChange={(event) => setAccountForm((current) => ({ ...current, smtpHost: event.target.value }))}
                placeholder="smtp.example.com"
                required
              />
            </label>
            <label className="mail-field">
              <span>SMTP 端口</span>
              <input
                type="number"
                min="1"
                max="65535"
                value={accountForm.smtpPort}
                onChange={(event) => setAccountForm((current) => ({ ...current, smtpPort: Number(event.target.value) }))}
                required
              />
            </label>
          </div>

          <div className="mail-account-options">
            <label className={'mail-secure-toggle' + (accountForm.secure ? ' is-on' : '')}>
              <input
                type="checkbox"
                checked={accountForm.secure}
                onChange={(event) => setAccountForm((current) => ({ ...current, secure: event.target.checked }))}
              />
              <span><strong>IMAP 使用 SSL / TLS</strong><small>通常为 993 端口</small></span>
            </label>
            <label className={'mail-secure-toggle' + (accountForm.smtpSecure ? ' is-on' : '')}>
              <input
                type="checkbox"
                checked={accountForm.smtpSecure}
                onChange={(event) => setAccountForm((current) => ({ ...current, smtpSecure: event.target.checked }))}
              />
              <span><strong>SMTP 使用 SSL / TLS</strong><small>465 端口开启；587 端口通常关闭以使用 STARTTLS</small></span>
            </label>
          </div>

          {(setupMessage || connectionStatus) && (
            <div className={'mail-connection-status' + (connectionStatus?.imap && connectionStatus.smtp ? ' is-success' : '')} role="status">
              {connectionStatus?.imap && connectionStatus.smtp ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
              <div>
                <strong>{connectionStatus ? accountStatusText(connectionStatus) : setupMessage}</strong>
                {connectionStatus?.imapError && <span>IMAP：{connectionStatus.imapError}</span>}
                {connectionStatus?.smtpError && <span>SMTP：{connectionStatus.smtpError}</span>}
              </div>
            </div>
          )}

          <footer className="mail-account-actions">
            <button type="submit" className="btn-primary" disabled={savingAccount}>
              {savingAccount ? <LoaderCircle size={16} className="is-spinning" /> : <ShieldCheck size={16} />}
              {savingAccount ? '保存中…' : account?.configured ? '保存更新' : '保存并连接'}
            </button>
            <button type="button" className="text-btn" onClick={() => void testConnection(true)} disabled={testingConnection || savingAccount}>
              <RefreshCw size={15} className={testingConnection ? 'is-spinning' : ''} />
              {testingConnection ? '测试中…' : '测试连接'}
            </button>
          </footer>
        </form>
      )}

      {account?.configured && (
        <div className={'mail-workspace' + (reader ? ' is-reading' : '') + (foldersOpen ? ' is-folders-open' : '')}>
          <header className="mail-workspace-toolbar">
            <div className="mail-account-summary">
              <span className="mail-eyebrow"><Mail size={14} />邮箱</span>
              <span>{account.user}</span>
            </div>
            <div className="mail-page-actions">
              <button
                type="button"
                className="text-btn mail-header-btn"
                onClick={() => void refreshMailbox(activeFolder)}
                disabled={loadingMailbox}
              >
                <RefreshCw size={15} className={loadingMailbox ? 'is-spinning' : ''} />
                刷新
              </button>
              <button
                type="button"
                className="text-btn mail-header-btn"
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <Settings size={15} />
                账户设置
              </button>
              <button
                type="button"
                className="btn-primary mail-compose-trigger"
                onClick={() => {
                  setComposer(emptyComposer());
                  setSendOperationId(null);
                  setComposerError('');
                  setComposerStatus('');
                  setComposerOpen(true);
                }}
              >
                <PenLine size={16} />
                写邮件
              </button>
            </div>
          </header>
          <aside id="mail-folders" className="mail-folders" aria-label="邮箱文件夹">
            <div className="mail-folders-head">
              <span>文件夹</span>
              <div>
                {mailbox && <small>{mailbox.unseen ? mailbox.unseen + ' 未读' : '已读完'}</small>}
                {reader && (
                  <button
                    type="button"
                    className="mail-folders-close"
                    onClick={() => setFoldersOpen(false)}
                    aria-label="关闭文件夹"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="mail-folder-list">
              {folders.map((folder) => {
                const selected = folder.path === activeFolder;
                const Icon = folder.specialUse === '\\Inbox' ? Inbox : Folder;
                return (
                  <button
                    key={folder.path}
                    type="button"
                    className={'mail-folder-item' + (selected ? ' is-selected' : '')}
                    onClick={() => selectFolder(folder.path)}
                    title={folder.path}
                  >
                    <Icon size={16} />
                    <span>{folderLabel(folder)}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="mail-list-panel" aria-label="邮件列表">
            <header className="mail-panel-head">
              <div>
                <h3>{folders.find((folder) => folder.path === activeFolder) ? folderLabel(folders.find((folder) => folder.path === activeFolder)!) : '邮件'}</h3>
                <p>{mailbox ? mailbox.total + ' 封邮件' : '正在读取邮件'}</p>
              </div>
              <button type="button" className="mail-panel-refresh" onClick={() => void refreshMailbox(activeFolder)} disabled={loadingMailbox} aria-label="刷新邮件">
                <RefreshCw size={15} className={loadingMailbox ? 'is-spinning' : ''} />
              </button>
            </header>
            {loadingMailbox && !messages.length ? (
              <div className="mail-list-state"><LoaderCircle size={20} className="is-spinning" /><span>正在同步邮件…</span></div>
            ) : mailboxError ? (
              <div className="mail-list-state is-error"><CircleAlert size={20} /><span>{mailboxError}</span><button type="button" className="text-btn" onClick={() => void refreshMailbox(activeFolder)}>重试</button></div>
            ) : messages.length ? (
              <div className="mail-list">
                {messages.map((message) => {
                  const selected = selectedSummary?.uid === message.uid && selectedSummary.folder === message.folder;
                  return (
                    <button
                      key={message.uid}
                      type="button"
                      className={'mail-list-item' + (!message.seen ? ' is-unread' : '') + (selected ? ' is-selected' : '')}
                      onClick={() => void openMessage(message)}
                    >
                      <span className="mail-sender-avatar" aria-hidden="true">{personLabel(message.from).slice(0, 1).toUpperCase()}</span>
                      <span className="mail-list-copy">
                        <span className="mail-list-topline"><strong>{personLabel(message.from)}</strong><time>{formatDate(message.receivedAt || message.date)}</time></span>
                        <span className="mail-list-subject">{message.subject}</span>
                        <span className="mail-list-meta">{formatSize(message.size) || '普通邮件'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mail-list-state"><Inbox size={22} /><span>这个文件夹暂时没有邮件</span></div>
            )}
          </section>

          <section className="mail-reader" aria-label="邮件阅读区">
            {reader && (
              <>
                <header className="mail-reader-head">
                  <div>
                    <h3>{reader.subject}</h3>
                    <div className="mail-reader-sender">
                      <span className="mail-sender-avatar large" aria-hidden="true">{personLabel(reader.from).slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{addressesText(reader.from)}</strong>
                        <span>发给 {addressesText(reader.to, account?.user || '我')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mail-reader-actions">
                    <button type="button" className="text-btn mail-reader-close" onClick={closeReader}>
                      <PanelRightClose size={15} />
                      收起阅读
                    </button>
                    <button
                      type="button"
                      className="text-btn mail-folder-trigger"
                      onClick={() => setFoldersOpen((open) => !open)}
                      aria-controls="mail-folders"
                      aria-expanded={foldersOpen}
                    >
                      <PanelLeftOpen size={15} />
                      文件夹
                    </button>
                    {selectedMessage && (
                      <button type="button" className="text-btn mail-reply-btn" onClick={startReply}>
                        <Reply size={15} />
                        回复
                      </button>
                    )}
                  </div>
                </header>
                <div className="mail-reader-meta">
                  <span>{formatDateTime(reader.receivedAt || reader.date)}</span>
                  {reader.size > 0 && <span>{formatSize(reader.size)}</span>}
                  {selectedMessage?.cc.length ? <span>抄送：{addressesText(selectedMessage.cc, '')}</span> : null}
                </div>
                {openingMessage ? (
                  <div className="mail-reader-loading"><LoaderCircle size={20} className="is-spinning" />正在读取正文…</div>
                ) : messageError ? (
                  <div className="mail-reader-error"><CircleAlert size={18} /><span>{messageError}</span><button type="button" className="text-btn" onClick={() => void openMessage(reader)}>重试</button></div>
                ) : selectedMessage ? (
                  <>
                    {selectedMessage.bodyUnavailable && <div className="mail-reader-notice"><CircleAlert size={16} />{selectedMessage.text}</div>}
                    {!selectedMessage.bodyUnavailable && (selectedMessage.html ? (
                      <iframe
                        className="mail-message-html"
                        title="受限显示的 HTML 邮件正文"
                        sandbox=""
                        referrerPolicy="no-referrer"
                        srcDoc={safeEmailDocument(selectedMessage.html)}
                      />
                    ) : <pre className="mail-message-body">{selectedMessage.text}</pre>)}
                    {selectedMessage.attachments.length > 0 && (
                      <div className="mail-attachments">
                        <span><Paperclip size={15} />附件 {selectedMessage.attachments.length} 个</span>
                        <div>
                          {selectedMessage.attachments.map((attachment, index) => (
                            <span key={attachment.filename + index}>{attachment.filename}<small>{formatSize(attachment.size)}</small></span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}

      {composerOpen && (
        <div className="mail-compose-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !sending) setComposerOpen(false); }}>
          <section className="mail-compose-dialog" role="dialog" aria-modal="true" aria-labelledby="mail-compose-title">
            <header>
              <div>
                <span className="mail-section-kicker"><PenLine size={14} />新邮件</span>
                <h2 id="mail-compose-title">写邮件</h2>
              </div>
              <button type="button" className="mail-close-settings" onClick={() => { setComposerOpen(false); setSendOperationId(null); }} disabled={sending} aria-label="关闭写邮件窗口">
                <X size={17} />
              </button>
            </header>
            <form onSubmit={sendMail}>
              <label className="mail-compose-field">
                <span>收件人</span>
                <input
                  type="text"
                  value={composer.to}
                  onChange={(event) => setComposer((current) => ({ ...current, to: event.target.value }))}
                  placeholder="name@example.com，多个地址用逗号分隔"
                  required
                  autoFocus
                />
              </label>
              <label className="mail-compose-field">
                <span>抄送</span>
                <input
                  type="text"
                  value={composer.cc}
                  onChange={(event) => setComposer((current) => ({ ...current, cc: event.target.value }))}
                  placeholder="可选，多个地址用逗号分隔"
                />
              </label>
              <label className="mail-compose-field">
                <span>主题</span>
                <input
                  type="text"
                  value={composer.subject}
                  onChange={(event) => setComposer((current) => ({ ...current, subject: event.target.value }))}
                  placeholder="邮件主题"
                />
              </label>
              <label className="mail-compose-field mail-compose-body-field">
                <span>正文</span>
                <textarea
                  value={composer.text}
                  onChange={(event) => setComposer((current) => ({ ...current, text: event.target.value }))}
                  placeholder="写下想说的话…"
                  rows={12}
                />
              </label>
              {composerError && <p className="mail-compose-error"><CircleAlert size={15} />{composerError}</p>}
              {composerStatus && <p className="mail-compose-status"><CheckCircle2 size={15} />{composerStatus}</p>}
              <footer>
                <span>将使用 {account?.user} 通过 SMTP 发出</span>
                <button type="submit" className="btn-primary" disabled={sending}>
                  {sending ? <LoaderCircle size={16} className="is-spinning" /> : <Send size={16} />}
                  {sending ? '发送中…' : '发送邮件'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
