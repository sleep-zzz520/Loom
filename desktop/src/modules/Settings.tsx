import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { SettingsKey } from '../App';
import type { AgentModelProfile, AppSettings, AppUpdateStatus, BackupRecord, NotificationHistoryItem } from '../types';
import { TimeField } from '../components/DateFields';
import { AVATAR_ACCEPT, avatarUploadError } from './profileAvatar';

type SettingsProps = {
  section: SettingsKey;
  onSelectSection: (section: SettingsKey) => void;
  onBack: () => void;
};

type SettingsSaveState = 'saved' | 'saving' | 'error';
type SettingsConfigPane = 'agent' | 'models' | 'github' | 'music' | 'recovery' | 'updates';

const SAVE_STATE_LABEL: Record<SettingsSaveState, string> = {
  saved: '已自动保存',
  saving: '保存中…',
  error: '保存失败，请重试',
};

const SETTINGS_PAGE_META: Record<SettingsKey, { title: string }> = {
  'settings-profile': {
    title: '个人资料',
  },
  'settings-notifications': {
    title: '通知',
  },
  'settings-config': {
    title: '系统与 Agent',
  },
};

const AGENT_PERSONALITY_OPTIONS: Array<{ value: AppSettings['agent']['persona']['personality']; label: string; hint: string }> = [
  { value: 'calm', label: '沉稳伙伴', hint: '清晰、有分寸' },
  { value: 'warm', label: '温暖陪伴', hint: '真诚、支持你' },
  { value: 'direct', label: '务实直率', hint: '直接、讲重点' },
  { value: 'coach', label: '启发教练', hint: '复盘、推动行动' },
  { value: 'creative', label: '灵感搭档', hint: '发散、给新视角' },
];

const AGENT_PROACTIVE_STYLE_OPTIONS: Array<{ value: AppSettings['agent']['persona']['proactiveStyle']; label: string; hint: string }> = [
  { value: 'important', label: '只说关键', hint: '短而明确' },
  { value: 'balanced', label: '适度提醒', hint: '友好、有重点' },
  { value: 'companion', label: '陪伴跟进', hint: '更关心进展' },
];

const SETTINGS_CONFIG_PANES: Array<{ id: SettingsConfigPane; label: string }> = [
  { id: 'agent', label: 'Agent' },
  { id: 'models', label: '模型服务' },
  { id: 'github', label: 'GitHub' },
  { id: 'music', label: '音乐服务' },
  { id: 'recovery', label: '数据与恢复' },
  { id: 'updates', label: '应用更新' },
];

export default function Settings({ section, onSelectSection, onBack }: SettingsProps) {
  const pageMeta = SETTINGS_PAGE_META[section];
  const [settings, setSettingsState] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<NotificationHistoryItem[]>([]);
  const [saveState, setSaveState] = useState<SettingsSaveState>('saved');
  const saveRevisionRef = useRef(0);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const avatarReadRevisionRef = useRef(0);
  const [avatarError, setAvatarError] = useState('');
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [configPane, setConfigPane] = useState<SettingsConfigPane>('models');
  const [selectedAgentModelProfileId, setSelectedAgentModelProfileId] = useState('');
  const [githubCheckBusy, setGithubCheckBusy] = useState(false);
  const [githubStatus, setGithubStatus] = useState<Awaited<ReturnType<typeof window.workbench.github.status>> | null>(null);
  const githubCheckRevisionRef = useRef(0);

  useEffect(() => {
    Promise.all([
      window.workbench.data.getSettings(),
      window.workbench.data.getModule('notificationHistory'),
    ]).then(([nextSettings, nextHistory]) => {
      setSettingsState(nextSettings);
      setHistory(nextHistory);
    }).catch(() => {});
  }, []);

  const loadBackups = useCallback(async () => {
    try {
      setBackups(await window.workbench.backup.list());
    } catch {
      setBackupMessage('备份列表暂时无法读取。');
    }
  }, []);

  useEffect(() => {
    if (section === 'settings-config') void loadBackups();
  }, [section, loadBackups]);

  useEffect(() => {
    let disposed = false;
    void window.workbench.updates.status()
      .then((status) => {
        if (!disposed) setUpdateStatus(status);
      })
      .catch(() => {
        if (!disposed) setUpdateStatus(null);
      });
    const stop = window.workbench.updates.onStatus((status) => {
      if (!disposed) setUpdateStatus(status);
    });
    return () => {
      disposed = true;
      stop();
    };
  }, []);

  const persistSettings = useCallback(async (nextSettings: AppSettings) => {
    const revision = saveRevisionRef.current;
    try {
      await window.workbench.data.setSettings({
        profile: nextSettings.profile,
        agent: nextSettings.agent,
        github: nextSettings.github,
        netease: nextSettings.netease,
        notify: nextSettings.notify,
        sync: nextSettings.sync,
      });
      if (revision === saveRevisionRef.current) {
        if (nextSettings.github?.token) {
          setSettingsState((current) => current?.github?.token === nextSettings.github.token
            ? { ...current, github: { ...current.github, token: '' } }
            : current);
        }
        setSaveState('saved');
      }
      return true;
    } catch {
      if (revision === saveRevisionRef.current) setSaveState('error');
      return false;
    }
  }, []);

  async function handleBack() {
    if (settings && saveState !== 'saved' && !(await persistSettings(settings))) return;
    onBack();
  }

  const pageNavigation = (
    <div className="settings-page-navigation">
      <button type="button" className="settings-back" onClick={() => void handleBack()}>
        <ArrowLeft size={18} aria-hidden="true" />返回
      </button>
    </div>
  );

  const settingsSidebar = (
    <aside className="settings-category-sidebar">
      <nav aria-label="设置分类">
        <div className="settings-category-group">
          <span className="settings-category-label">个人</span>
          {(['settings-profile', 'settings-notifications'] as SettingsKey[]).map((key) => (
            <button key={key} type="button" className={section === key ? 'is-active' : ''}
              aria-current={section === key ? 'page' : undefined} onClick={() => onSelectSection(key)}>
              {SETTINGS_PAGE_META[key].title}
            </button>
          ))}
        </div>
        <div className="settings-category-group">
          <span className="settings-category-label">系统与 Agent</span>
          {SETTINGS_CONFIG_PANES.map((pane) => (
            <button key={pane.id} type="button" className={section === 'settings-config' && configPane === pane.id ? 'is-active' : ''}
              aria-current={section === 'settings-config' && configPane === pane.id ? 'page' : undefined}
              onClick={() => { setConfigPane(pane.id); onSelectSection('settings-config'); }}>
              {pane.label}
            </button>
          ))}
        </div>
      </nav>
    </aside>
  );

  useEffect(() => {
    if (!settings || saveState !== 'saving') return;
    const timer = window.setTimeout(() => void persistSettings(settings), 650);
    return () => window.clearTimeout(timer);
  }, [settings, saveState, persistSettings]);

  const checkGithub = useCallback(async () => {
    const revision = ++githubCheckRevisionRef.current;
    setGithubCheckBusy(true);
    try {
      const result = await window.workbench.github.status();
      if (revision === githubCheckRevisionRef.current) setGithubStatus(result);
    } catch (error) {
      if (revision === githubCheckRevisionRef.current) {
        setGithubStatus({ connected: false, enabled: false, tokenConfigured: false, toolCount: 0,
          message: error instanceof Error ? error.message : '无法读取 GitHub 连接状态' });
      }
    } finally {
      if (revision === githubCheckRevisionRef.current) setGithubCheckBusy(false);
    }
  }, []);

  useEffect(() => {
    if (configPane !== 'github' || !settings || saveState !== 'saved') return;
    void checkGithub();
    return () => { githubCheckRevisionRef.current += 1; };
  }, [configPane, settings?.github?.enabled, settings?.github?.token, saveState, checkGithub]);

  if (!settings) {
    return (
      <section className="module-page">
        <div className={`settings-grid settings-grid--${section}`}>
          {pageNavigation}
          {settingsSidebar}
          <section className="settings-section" aria-label="设置内容">
            <h2 className="page-title">设置</h2>
            <p className="page-sub">读取设置中</p>
          </section>
        </div>
      </section>
    );
  }

  // 开发环境的渲染器可先热更新、主进程随后才重启；旧主进程返回单模型数据时，
  // 先在界面中映射为一条默认档案，避免 Settings 因读取不存在的数组而白屏。
  const visibleAgentModelProfiles: AgentModelProfile[] = Array.isArray(settings.agent.modelProfiles)
    ? settings.agent.modelProfiles
    : (settings.agent.apiBase || settings.agent.apiKey || settings.agent.model
      ? [{
        id: 'legacy-default',
        name: settings.agent.model || '默认模型',
        apiBase: settings.agent.apiBase,
        apiKey: settings.agent.apiKey,
        model: settings.agent.model,
      }]
      : []);
  const defaultAgentModelProfileId = settings.agent.defaultModelProfileId
    || visibleAgentModelProfiles[0]?.id
    || '';
  const selectedAgentModelProfile = visibleAgentModelProfiles.find((profile) => profile.id === selectedAgentModelProfileId) || null;

  function update(patch: Partial<AppSettings>) {
    if (!settings) return;
    const next: AppSettings = {
      ...settings,
      ...patch,
      email: settings.email,
      profile: patch.profile ?? settings.profile,
      netease: patch.netease ?? settings.netease,
      github: patch.github ?? settings.github,
      notify: patch.notify ?? settings.notify,
      agent: patch.agent ?? settings.agent,
      sync: patch.sync ?? settings.sync,
    };
    setSettingsState(next);
    saveRevisionRef.current += 1;
    setSaveState('saving');
  }

  function updateAgentModelProfile(profileId: string, patch: Partial<AgentModelProfile>) {
    if (!settings) return;
    const modelProfiles = visibleAgentModelProfiles.map((profile) => (
      profile.id === profileId ? { ...profile, ...patch } : profile
    ));
    update({ agent: { ...settings.agent, modelProfiles } });
  }

  function addAgentModelProfile() {
    if (!settings) return;
    const modelProfiles = visibleAgentModelProfiles;
    const profile: AgentModelProfile = {
      id: globalThis.crypto?.randomUUID?.() || `model-${Date.now()}`,
      name: `模型 ${modelProfiles.length + 1}`,
      apiBase: '',
      apiKey: '',
      model: '',
    };
    setSelectedAgentModelProfileId(profile.id);
    update({
      agent: {
        ...settings.agent,
        modelProfiles: [...modelProfiles, profile],
        defaultModelProfileId: defaultAgentModelProfileId || profile.id,
      },
    });
  }

  function removeAgentModelProfile(profileId: string) {
    if (!settings) return;
    const modelProfiles = visibleAgentModelProfiles.filter((profile) => profile.id !== profileId);
    const defaultModelProfileId = defaultAgentModelProfileId === profileId
      ? modelProfiles[0]?.id || ''
      : defaultAgentModelProfileId;
    if (selectedAgentModelProfileId === profileId) setSelectedAgentModelProfileId('');
    update({
      agent: {
        ...settings.agent,
        modelProfiles,
        defaultModelProfileId,
        ...(modelProfiles.length ? {} : { apiBase: '', apiKey: '', model: '' }),
      },
    });
  }

  function setDefaultAgentModelProfile(profileId: string) {
    if (!settings || profileId === defaultAgentModelProfileId) return;
    update({ agent: { ...settings.agent, defaultModelProfileId: profileId } });
  }

  function retrySave() {
    if (!settings || saveState === 'saving') return;
    saveRevisionRef.current += 1;
    setSaveState('saving');
  }

  function toggleReminder(minutes: number) {
    if (!settings) return;
    const current = settings.notify.reminderMinutes;
    const next = current.includes(minutes)
      ? current.filter((item) => item !== minutes)
      : [...current, minutes].sort((a, b) => b - a);
    if (next.length) update({ notify: { ...settings.notify, reminderMinutes: next } });
  }

  function setAvatar(avatarDataUrl: string) {
    if (!settings) return;
    update({ profile: { ...settings.profile, avatarDataUrl } });
    window.dispatchEvent(new CustomEvent('workbench:profile-avatar', { detail: avatarDataUrl }));
  }

  function chooseAvatar() {
    avatarInputRef.current?.click();
  }

  function removeAvatar() {
    avatarReadRevisionRef.current += 1;
    setAvatarError('');
    setAvatar('');
  }

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    const validationError = avatarUploadError(file);
    if (validationError) {
      setAvatarError(validationError);
      return;
    }

    const revision = ++avatarReadRevisionRef.current;
    const reader = new FileReader();
    reader.onerror = () => {
      if (revision === avatarReadRevisionRef.current) setAvatarError('图片读取失败，请重新选择。');
    };
    reader.onload = () => {
      if (revision !== avatarReadRevisionRef.current) return;
      const avatarDataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!avatarDataUrl.startsWith('data:image/')) {
        setAvatarError('图片格式无法识别，请重新选择。');
        return;
      }
      const image = new Image();
      image.onerror = () => {
        if (revision === avatarReadRevisionRef.current) setAvatarError('图片格式无法识别，请重新选择。');
      };
      image.onload = () => {
        if (revision !== avatarReadRevisionRef.current) return;
        setAvatarError('');
        setAvatar(avatarDataUrl);
      };
      image.src = avatarDataUrl;
    };
    reader.readAsDataURL(file);
  }

  async function createBackup() {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupMessage('');
    try {
      await window.workbench.backup.create();
      await loadBackups();
      setBackupMessage('已创建当前数据的恢复点。');
    } catch {
      setBackupMessage('创建备份失败，请稍后重试。');
    } finally {
      setBackupBusy(false);
    }
  }

  async function exportData() {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupMessage('');
    try {
      const result = await window.workbench.backup.exportData();
      setBackupMessage(result.saved ? '数据已导出。导出文件不包含授权码、API 密钥和同步令牌。' : '已取消导出。');
    } catch {
      setBackupMessage('导出失败，请稍后重试。');
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreBackup(id: string) {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupMessage('');
    try {
      const result = await window.workbench.backup.restore(id);
      if (result.restored) {
        await loadBackups();
        setBackupMessage('已恢复备份；当前版本已自动保留为新的恢复点。');
      } else {
        setBackupMessage('已取消恢复。');
      }
    } catch {
      setBackupMessage('恢复失败，当前数据没有被替换。');
    } finally {
      setBackupBusy(false);
    }
  }

  async function runUpdateAction(action: 'check' | 'download' | 'cancel' | 'install') {
    if (action === 'cancel') {
      setUpdateStatus(await window.workbench.updates.cancel());
      return;
    }
    setUpdateBusy(true);
    try {
      const next = action === 'check'
        ? await window.workbench.updates.check()
        : action === 'download'
          ? await window.workbench.updates.download()
          : await window.workbench.updates.install();
      setUpdateStatus(next);
    } catch (error) {
      setUpdateStatus((current) => ({
        state: 'error',
        currentVersion: current?.currentVersion || '—',
        availableVersion: current?.availableVersion || null,
        releaseNotes: current?.releaseNotes || '',
        releaseDate: current?.releaseDate || null,
        downloadPercent: null,
        message: `更新失败：${error instanceof Error ? error.message : '未知错误'}`,
        canCheck: true,
        canDownload: false,
        canCancel: false,
        canInstall: false,
      }));
    } finally {
      setUpdateBusy(false);
    }
  }

  return (
    <section className="module-page">
      <div className={`settings-grid settings-grid--${section}`}>
        {pageNavigation}
        {settingsSidebar}
        <section className="settings-section" data-settings-page={section} aria-label="设置内容">
          <header className="settings-page-header">
            <div className="settings-page-heading">
              <h2 id="settings-page-title">{section === 'settings-config' ? SETTINGS_CONFIG_PANES.find((pane) => pane.id === configPane)?.label : pageMeta.title}</h2>
            </div>
            <div className="settings-header-actions">
              <div className="settings-save-bar">
              <span className={`settings-save-state ${saveState}`} role="status" aria-live="polite">
                <span className="settings-save-state-dot" aria-hidden="true" />
                <span>{SAVE_STATE_LABEL[saveState]}</span>
              </span>
              {saveState === 'error' && <button type="button" className="settings-save-retry" onClick={retrySave}>重试</button>}
              </div>
            </div>
          </header>
          <div key={section} className={`settings-section-content settings-section-content--${section}`}>
          {section === 'settings-profile' && <>
          <section className="settings-subsection settings-subsection--identity" aria-labelledby="profile-identity-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="profile-identity-title">个人身份</h3>
              </div>
            </div>
            <div className="settings-profile-identity">
              <div className="profile-avatar-card">
                <div className="profile-avatar-preview">
                  <div className="brand-avatar" aria-hidden="true">
                    {settings.profile.avatarDataUrl && <img src={settings.profile.avatarDataUrl} alt="" />}
                  </div>
                </div>
                <div className="profile-avatar-copy">
                  <strong>头像</strong>
                  <input ref={avatarInputRef} className="profile-avatar-input" type="file" accept={AVATAR_ACCEPT} onChange={handleAvatarChange} tabIndex={-1} />
                  <div className="profile-avatar-actions">
                    <button type="button" className="profile-avatar-action" onClick={chooseAvatar}>{settings.profile.avatarDataUrl ? '更换头像' : '上传头像'}</button>
                    {settings.profile.avatarDataUrl && <button type="button" className="profile-avatar-remove" onClick={removeAvatar}>移除</button>}
                  </div>
                  <small>JPG / PNG · 最大 5MB</small>
                  {avatarError && <span className="profile-avatar-error" role="alert">{avatarError}</span>}
                </div>
              </div>
              <div className="settings-profile-fields">
                <label className="field">
                  <span>姓名</span>
                  <input
                    value={settings.profile.name}
                    onChange={(event) => update({ profile: { ...settings.profile, name: event.target.value } })}
                    placeholder="你的名字"
                  />
                </label>
                <label className="field">
                  <span>怎么称呼</span>
                  <input
                    value={settings.profile.nickname}
                    onChange={(event) => update({ profile: { ...settings.profile, nickname: event.target.value } })}
                    placeholder="例如：小穆、Mumu"
                  />
                </label>
                <label className="field settings-profile-role">
                  <span>当前身份 / 工作场景</span>
                  <input
                    value={settings.profile.role}
                    onChange={(event) => update({ profile: { ...settings.profile, role: event.target.value } })}
                    placeholder="例如：独立开发者、产品经理"
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="settings-subsection settings-subsection--context" aria-labelledby="profile-context-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="profile-context-title">个人背景</h3>
              </div>
            </div>
            <label className="field">
              <span>长期背景</span>
              <textarea
                rows={3}
                value={settings.profile.about}
                onChange={(event) => update({ profile: { ...settings.profile, about: event.target.value } })}
                placeholder="如：独立开发、产品设计与文档整理。"
              />
            </label>
            <label className="field">
              <span>当前重点</span>
              <textarea
                rows={2}
                value={settings.profile.currentFocus}
                onChange={(event) => update({ profile: { ...settings.profile, currentFocus: event.target.value } })}
                placeholder="如：完成 Loom 设置页改造。"
              />
            </label>
          </section>

          <section className="settings-subsection settings-subsection--preferences" aria-labelledby="profile-agent-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="profile-agent-title">Agent 工作方式</h3>
              </div>
            </div>
            <div className="settings-profile-preferences">
              <fieldset className="settings-choice-fieldset">
                <legend>回答长度</legend>
                <div className="settings-choice-group" role="radiogroup" aria-label="回答长度">
                  {[
                    { value: 'concise', label: '简洁', hint: '先讲结论' },
                    { value: 'balanced', label: '适中', hint: '结论加关键原因' },
                    { value: 'detailed', label: '详细', hint: '完整拆解过程' },
                  ].map((option) => (
                    <label key={option.value} className={`settings-choice${settings.profile.responseLength === option.value ? ' is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="response-length"
                        value={option.value}
                        checked={settings.profile.responseLength === option.value}
                        onChange={() => update({ profile: { ...settings.profile, responseLength: option.value as AppSettings['profile']['responseLength'] } })}
                      />
                      <span className="settings-choice-copy"><strong>{option.label}</strong><small>{option.hint}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="settings-choice-fieldset">
                <legend>执行修改前</legend>
                <div className="settings-choice-group" role="radiogroup" aria-label="执行修改前">
                  {[
                    { value: 'mutations-only', label: '修改前确认', hint: '涉及数据变更时' },
                    { value: 'always-explain', label: '先说明计划', hint: '多步骤任务时' },
                  ].map((option) => (
                    <label key={option.value} className={`settings-choice${settings.profile.confirmationMode === option.value ? ' is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="confirmation-mode"
                        value={option.value}
                        checked={settings.profile.confirmationMode === option.value}
                        onChange={() => update({ profile: { ...settings.profile, confirmationMode: option.value as AppSettings['profile']['confirmationMode'] } })}
                      />
                      <span className="settings-choice-copy"><strong>{option.label}</strong><small>{option.hint}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </section>

          <section className="settings-subsection settings-subsection--rules" aria-labelledby="profile-rules-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="profile-rules-title">长期规则</h3>
              </div>
            </div>
            <label className="field">
              <span>工作方式偏好</span>
              <textarea
                rows={5}
                value={settings.profile.preferences.join('\n')}
                onChange={(event) => update({
                  profile: {
                    ...settings.profile,
                    preferences: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
                  },
                })}
                placeholder={'例如：\n先讲结论，再说明原因\n代码修改尽量小，不做无关重构\n涉及删除数据时先提醒我'}
              />
            </label>
          </section>
          </>}

          {section === 'settings-notifications' && <>
          <fieldset className="notify-fieldset settings-subsection settings-notify-rhythm">
            <legend>截止提醒</legend>
            <div className="notify-checks">
              {[
                { minutes: 1440, label: '提前 1 天' },
                { minutes: 240, label: '提前 4 小时' },
                { minutes: 60, label: '提前 1 小时' },
              ].map(({ minutes, label }) => (
                <label key={minutes} className={`notify-check${settings.notify.reminderMinutes.includes(minutes) ? ' is-selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={settings.notify.reminderMinutes.includes(minutes)}
                    onChange={() => toggleReminder(minutes)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <section className="settings-subsection" aria-labelledby="notification-rhythm-title">
            <div className="settings-subsection-head">
              <h3 id="notification-rhythm-title">提醒节奏</h3>
            </div>
            <div className="notify-time-row">
              <label className="field">
                <span>免打扰开始</span>
                <TimeField
                  value={settings.notify.quietHours.start}
                  ariaLabel="免打扰开始时间"
                  onChange={(start) => update({ notify: { ...settings.notify, quietHours: { ...settings.notify.quietHours, start } } })}
                />
              </label>
              <label className="field">
                <span>免打扰结束</span>
                <TimeField
                  value={settings.notify.quietHours.end}
                  ariaLabel="免打扰结束时间"
                  onChange={(end) => update({ notify: { ...settings.notify, quietHours: { ...settings.notify.quietHours, end } } })}
                />
              </label>
            </div>
            <label className="field">
              <span>每日主动提醒上限</span>
              <input
                type="number"
                min="1"
                max="20"
                value={settings.notify.maxDailyNotifications}
                onChange={(event) => update({ notify: { ...settings.notify, maxDailyNotifications: Math.min(20, Math.max(1, Number(event.target.value) || 1)) } })}
              />
            </label>
          </section>
          <section className="settings-subsection" aria-labelledby="notification-channel-title">
            <div className="settings-subsection-head">
              <h3 id="notification-channel-title">手机推送</h3>
            </div>
            <label className="field">
              <span>推送渠道</span>
              <select
                value={settings.notify.channel}
                onChange={(event) =>
                  update({ notify: { ...settings.notify, channel: event.target.value as 'ntfy' | 'bark' | 'none' } })
                }
              >
                <option value="ntfy">ntfy（Android / 通用）</option>
                <option value="bark">Bark（iOS 推荐）</option>
                <option value="none">关闭手机推送</option>
              </select>
            </label>

            {settings.notify.channel !== 'none' && (
              <div key={settings.notify.channel} className="settings-channel-panel" aria-live="polite">
            {settings.notify.channel === 'ntfy' && <>
              <label className="field">
                <span>Service URL</span>
                <input
                  value={settings.notify.ntfyUrl}
                  onChange={(event) =>
                    update({ notify: { ...settings.notify, ntfyUrl: event.target.value } })
                  }
                  placeholder="https://ntfy.sh"
                />
              </label>
              <label className="field">
                <span>Topic</span>
                <input
                  value={settings.notify.ntfyTopic}
                  onChange={(event) =>
                    update({ notify: { ...settings.notify, ntfyTopic: event.target.value } })
                  }
                  placeholder="输入一个自定义的 topic 名称，如 my-workbench"
                />
              </label>
              <p className="settings-detail-note">
                在 ntfy 中订阅相同 Topic。
              </p>
            </>}

            {settings.notify.channel === 'bark' && <>
              <label className="field">
                <span>Bark 推送地址</span>
                <input
                  value={settings.notify.barkUrl}
                  onChange={(event) =>
                    update({ notify: { ...settings.notify, barkUrl: event.target.value } })
                  }
                  placeholder="https://api.day.app/你的设备Key"
                />
              </label>
              <p className="settings-detail-note">
                粘贴 Bark App 中复制的推送地址。
              </p>
            </>}
            </div>
            )}
          </section>
          {history.length > 0 && (
            <section className="settings-subsection">
              <div className="notification-history" aria-label="最近通知">
                <p>最近通知</p>
                {history.slice(0, 5).map((item) => (
                  <div key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.body} · {new Date(item.sentAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          </>}

          {section === 'settings-config' && <div className={`settings-config-workspace is-${configPane}`}>
            <div className="settings-config-panel">
          <section hidden={configPane !== 'updates'} className="settings-subsection settings-subsection--updates" aria-labelledby="settings-page-title">
            <div className={`settings-update-card is-${updateStatus?.state || 'loading'}`} aria-live="polite">
              <div className="settings-update-copy">
                <span className="settings-update-kicker">当前版本 {updateStatus?.currentVersion || '读取中…'}</span>
                <strong>{updateStatus?.state === 'available' ? `Loom ${updateStatus.availableVersion || '新版本'} 已可下载` : updateStatus?.state === 'downloaded' ? '新版本已准备好' : updateStatus?.state === 'downloading' ? '正在下载新版本' : updateStatus?.state === 'checking' ? '正在检查新版本' : updateStatus?.state === 'up-to-date' ? '已经是最新版本' : updateStatus?.state === 'unavailable' ? '此版本不提供应用内更新' : updateStatus?.state === 'error' ? '暂时无法检查更新' : '可以检查新版本'}</strong>
                <p>{updateStatus?.message || '正在读取更新状态…'}</p>
                {updateStatus?.releaseNotes && <small className="settings-update-notes">本次更新：{updateStatus.releaseNotes}</small>}
                {updateStatus?.state === 'downloading' && <span className="settings-update-progress" aria-label={`下载进度 ${updateStatus.downloadPercent ?? 0}%`}><i style={{ width: `${updateStatus.downloadPercent ?? 0}%` }} /></span>}
              </div>
              {updateStatus?.state !== 'unavailable' && <div className="settings-update-actions">
                {updateStatus?.canInstall ? <button type="button" className="settings-update-primary" onClick={() => void runUpdateAction('install')} disabled={updateBusy}>重启并更新</button>
                  : updateStatus?.canDownload ? <button type="button" className="settings-update-primary" onClick={() => void runUpdateAction('download')} disabled={updateBusy}>下载更新</button>
                    : updateStatus?.canCancel ? <button type="button" className="settings-update-secondary" onClick={() => void runUpdateAction('cancel')}>取消下载</button>
                    : <button type="button" className="settings-update-secondary" onClick={() => void runUpdateAction('check')} disabled={updateBusy || !updateStatus?.canCheck}>检查更新</button>}
              </div>}
            </div>
          </section>
          <section hidden={configPane !== 'agent'} className="settings-subsection settings-subsection--persona" aria-labelledby="agent-persona-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="agent-persona-title">身份与沟通</h3>
              </div>
            </div>
            <label className="field">
              <span>Agent 名字</span>
              <input
                value={settings.agent.persona.name}
                onChange={(event) => update({
                  agent: { ...settings.agent, persona: { ...settings.agent.persona, name: event.target.value } },
                })}
                maxLength={32}
                placeholder="例如：小栖"
              />
            </label>
            <fieldset className="settings-choice-fieldset">
              <legend>基础人格</legend>
              <div className="settings-choice-group agent-persona-options" role="radiogroup" aria-label="Agent 基础人格">
                {AGENT_PERSONALITY_OPTIONS.map((option) => (
                  <label key={option.value} className={`settings-choice${settings.agent.persona.personality === option.value ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="agent-personality"
                      value={option.value}
                      checked={settings.agent.persona.personality === option.value}
                      onChange={() => update({
                        agent: { ...settings.agent, persona: { ...settings.agent.persona, personality: option.value } },
                      })}
                    />
                    <span className="settings-choice-copy"><strong>{option.label}</strong><small>{option.hint}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="settings-choice-fieldset">
              <legend>主动联系时</legend>
              <div className="settings-choice-group agent-proactive-style-options" role="radiogroup" aria-label="Agent 主动沟通方式">
                {AGENT_PROACTIVE_STYLE_OPTIONS.map((option) => (
                  <label key={option.value} className={`settings-choice${settings.agent.persona.proactiveStyle === option.value ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="agent-proactive-style"
                      value={option.value}
                      checked={settings.agent.persona.proactiveStyle === option.value}
                      onChange={() => update({
                        agent: { ...settings.agent, persona: { ...settings.agent.persona, proactiveStyle: option.value } },
                      })}
                    />
                    <span className="settings-choice-copy"><strong>{option.label}</strong><small>{option.hint}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span>自定义合作约定</span>
              <textarea
                value={settings.agent.persona.customInstructions}
                onChange={(event) => update({
                  agent: { ...settings.agent, persona: { ...settings.agent.persona, customInstructions: event.target.value } },
                })}
                maxLength={1200}
                placeholder="例如：少用表情；发现风险先直说；讨论创意时先给三个方向。"
              />
            </label>
          </section>
          <section hidden={configPane !== 'agent'} className="settings-subsection settings-subsection--proactive" aria-labelledby="agent-proactive-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="agent-proactive-title">主动发现</h3>
              </div>
            </div>
            <label className={`settings-toggle${settings.agent.proactiveEnabled !== false ? ' is-on' : ''}`}>
              <span className="settings-toggle-copy">
                <strong>启用主动建议</strong>
              </span>
              <input
                type="checkbox"
                checked={settings.agent.proactiveEnabled !== false}
                onChange={(event) => update({ agent: { ...settings.agent, proactiveEnabled: event.target.checked } })}
                aria-label="启用主动建议"
              />
              <span className="settings-toggle-track" aria-hidden="true"><span /></span>
            </label>
            <label className={`settings-toggle${settings.agent.emailMonitorEnabled ? ' is-on' : ''}`}>
              <span className="settings-toggle-copy">
                <strong>智能邮件提醒</strong>
              </span>
              <input
                type="checkbox"
                checked={settings.agent.emailMonitorEnabled === true}
                onChange={(event) => update({ agent: { ...settings.agent, emailMonitorEnabled: event.target.checked } })}
                aria-label="启用智能邮件提醒"
              />
              <span className="settings-toggle-track" aria-hidden="true"><span /></span>
            </label>
          </section>
          <section hidden={configPane !== 'models'} className="settings-subsection settings-subsection--connection settings-agent-models-panel" aria-labelledby="settings-page-title">
            <div className="settings-model-manager">
              <div className="settings-model-list" aria-label="已保存的模型配置">
                <div className="settings-model-list-head"><strong>模型</strong><button type="button" className="settings-model-profile-add" onClick={addAgentModelProfile}>添加</button></div>
                <div className="settings-model-list-scroll">
                  {visibleAgentModelProfiles.map((profile) => <button key={profile.id} type="button" className={`settings-model-list-item${selectedAgentModelProfileId === profile.id ? ' is-selected' : ''}`} onClick={() => setSelectedAgentModelProfileId(profile.id)} aria-pressed={selectedAgentModelProfileId === profile.id}>
                    <span><strong>{profile.name || profile.model || '未命名模型'}</strong><small>{profile.model || '未设置模型'}</small></span>
                    {profile.id === defaultAgentModelProfileId && <em>默认</em>}
                  </button>)}
                </div>
              </div>
              <div className="settings-model-editor">
                {selectedAgentModelProfile ? <>
                  <div className="settings-model-editor-head">
                    <div><h4>{selectedAgentModelProfile.name || selectedAgentModelProfile.model || '未命名模型'}</h4><small>{selectedAgentModelProfile.model || '未设置模型'}</small></div>
                    <div className="settings-model-editor-actions">
                      {selectedAgentModelProfile.id === defaultAgentModelProfileId ? <span>默认模型</span> : <button type="button" onClick={() => setDefaultAgentModelProfile(selectedAgentModelProfile.id)}>设为默认</button>}
                      <button type="button" className="settings-model-profile-remove" onClick={() => removeAgentModelProfile(selectedAgentModelProfile.id)}>删除</button>
                    </div>
                  </div>
                  <div className="settings-agent-service-fields">
                    <label className="field settings-agent-api-base"><span>API 地址</span><input value={selectedAgentModelProfile.apiBase} onChange={(event) => updateAgentModelProfile(selectedAgentModelProfile.id, { apiBase: event.target.value })} placeholder="https://api.deepseek.com/v1" /><small className="field-hint">切换来源后需重新输入密钥。</small></label>
                    <label className="field settings-agent-profile-name"><span>配置名称</span><input value={selectedAgentModelProfile.name} onChange={(event) => updateAgentModelProfile(selectedAgentModelProfile.id, { name: event.target.value })} placeholder="例如：GLM 主模型" /></label>
                    <label className="field"><span>API 密钥</span><input type="password" value={selectedAgentModelProfile.apiKey} onChange={(event) => updateAgentModelProfile(selectedAgentModelProfile.id, { apiKey: event.target.value })} placeholder="sk-..." /><small className="field-hint">已保存的密钥不会回显。</small></label>
                    <label className="field settings-agent-model"><span>模型</span><input value={selectedAgentModelProfile.model} onChange={(event) => updateAgentModelProfile(selectedAgentModelProfile.id, { model: event.target.value })} placeholder="deepseek-chat" /></label>
                  </div>
                </> : <p className="settings-model-editor-empty">从左侧选择模型后再编辑。</p>}
              </div>
            </div>
          </section>
          <section hidden={configPane !== 'github'} className="settings-subsection settings-subsection--connection" aria-labelledby="settings-page-title">
            <p className="github-connection-intro">先填写访问令牌，再开启 GitHub 并测试连接。连接后，Agent 可查询仓库、Issue 和 Pull Request；创建 Issue 前会请你确认。</p>
            <div className={`github-connection-status${githubStatus?.connected ? ' is-connected' : ''}${githubStatus?.enabled && githubStatus.tokenConfigured && !githubStatus.connected && !githubCheckBusy ? ' is-error' : ''}`} role="status" aria-live="polite">
              <span className="github-connection-dot" aria-hidden="true" />
              <div>
                <strong>{saveState === 'saving' ? '正在保存连接设置…' : githubCheckBusy ? '正在检查连接…' : githubStatus?.connected ? '已连接 GitHub' : githubStatus?.tokenConfigured ? githubStatus.enabled ? '连接未成功' : '已保存令牌，尚未启用' : '尚未配置'}</strong>
                <span>{saveState === 'saving' ? '保存完成后将更新连接状态' : githubCheckBusy ? '请稍候' : githubStatus?.connected ? `${githubStatus.toolCount} 项工具可用` : githubStatus?.message || '保存访问令牌后可测试连接'}</span>
              </div>
            </div>
            <label className="field github-token-field">
              <span>访问令牌</span>
              <input
                type="password"
                value={settings.github?.token || ''}
                onChange={(event) => { update({ github: { ...settings.github, token: event.target.value } }); setGithubStatus(null); }}
                placeholder={githubStatus?.tokenConfigured ? '输入新令牌以替换已保存的令牌' : '粘贴 GitHub 访问令牌'}
                autoComplete="off"
              />
            </label>
            <p className="github-token-note">已保存的令牌不会回显；留空会保留原令牌。令牌仅在本机加密保存。</p>
            <label className={`settings-toggle github-enable-row${settings.github?.enabled ? ' is-on' : ''}`}>
              <span className="settings-toggle-copy"><strong>允许 Agent 使用 GitHub</strong></span>
              <input
                type="checkbox"
                checked={settings.github?.enabled === true}
                onChange={(event) => { update({ github: { ...settings.github, enabled: event.target.checked } }); setGithubStatus(null); }}
                aria-label="允许 Agent 使用 GitHub"
              />
              <span className="settings-toggle-track" aria-hidden="true"><span /></span>
            </label>
            <div className="github-connection-actions">
              <button type="button" className="settings-recovery-secondary" disabled={githubCheckBusy || saveState !== 'saved' || !settings.github?.enabled || !githubStatus?.tokenConfigured} onClick={() => void checkGithub()}>{githubCheckBusy ? '连接中…' : githubStatus?.connected ? '重新测试连接' : '测试连接'}</button>
              <a href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" target="_blank" rel="noreferrer">如何创建访问令牌</a>
            </div>
            <details className="github-connection-help">
              <summary>令牌权限与使用范围</summary>
              <p>只授权需要访问的仓库。读取仓库内容、Issue 和 Pull Request 需要对应的读取权限；创建 Issue 还需要该仓库的 Issues 写入权限。Loom 暂不开放合并 PR 或推送代码。</p>
            </details>
          </section>
          <details hidden={configPane !== 'music'} className="settings-advanced-section">
            <summary>
              <span className="settings-advanced-summary-copy">
                <strong>连接设置</strong>
              </span>
              <span className="settings-advanced-label">高级</span>
            </summary>
            <div className="settings-advanced-content">
              <label className="field">
                <span>服务地址</span>
                <input
                  value={settings.netease.apiBase}
                  onChange={(event) => update({ netease: { apiBase: event.target.value } })}
                  placeholder="http://127.0.0.1:3000"
                />
              <small className="field-hint">默认地址由工作台管理；切换远程服务会退出音乐账号。</small>
              </label>
            </div>
          </details>
          <section hidden={configPane !== 'recovery'} className="settings-subsection settings-subsection--recovery" aria-labelledby="settings-page-title">
            <div className="settings-subsection-head">
              <div>
                <p>备份和导出不包含密钥。</p>
              </div>
            </div>
            <div className="settings-recovery-actions">
              <button type="button" className="settings-recovery-primary" onClick={() => void createBackup()} disabled={backupBusy}>立即备份</button>
              <button type="button" className="settings-recovery-secondary" onClick={() => void exportData()} disabled={backupBusy}>导出数据</button>
            </div>
            {backupMessage && <p className="settings-recovery-message" role="status">{backupMessage}</p>}
            {backups.length ? <>
              <div className="settings-backup-list-heading">
                <strong>可恢复版本</strong>
                <small>恢复前会保留当前版本</small>
              </div>
              <div className="settings-backup-list" aria-label="可恢复的数据版本">
                {backups.slice(0, 6).map((backup) => <div key={backup.id} className="settings-backup-item"><span><strong>{backup.reason === 'manual' ? '手动备份' : backup.reason === 'pre-restore' ? '恢复前保护' : '自动恢复点'}</strong><small>{new Date(backup.createdAt).toLocaleString('zh-CN', { hour12: false })} · {Math.max(1, Math.round(backup.size / 1024))} KB</small></span><button type="button" onClick={() => void restoreBackup(backup.id)} disabled={backupBusy}>恢复此版本</button></div>)}
              </div>
            </> : <p className="settings-recovery-empty">暂无恢复点；保存数据后会自动创建。</p>}
          </section>
            </div>
          </div>}
          </div>
        </section>
      </div>
    </section>
  );
}
