import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { SettingsKey } from '../App';
import type { AppSettings, NotificationHistoryItem } from '../types';
import { TimeField } from '../components/DateFields';

type SettingsProps = {
  section: SettingsKey;
};

type SettingsSaveState = 'saved' | 'saving' | 'error';

const SECTION_INFO: Record<SettingsKey, { title: string; description: string }> = {
  'settings-profile': {
    title: '个人资料',
    description: '让 Agent 更自然地理解你的背景、习惯与偏好。',
  },
  'settings-notifications': {
    title: '通知',
    description: '管理提醒时间、免打扰时段和手机推送。',
  },
  'settings-config': {
    title: '配置',
    description: '设定 Agent 的身份与主动沟通方式，并管理模型服务连接。',
  },
};

const SAVE_STATE_LABEL: Record<SettingsSaveState, string> = {
  saved: '✓ 已保存',
  saving: '保存中…',
  error: '保存失败',
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

export default function Settings({ section }: SettingsProps) {
  const [settings, setSettingsState] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<NotificationHistoryItem[]>([]);
  const [saveState, setSaveState] = useState<SettingsSaveState>('saved');
  const saveRevisionRef = useRef(0);
  const sectionInfo = SECTION_INFO[section];

  useEffect(() => {
    Promise.all([
      window.workbench.data.getSettings(),
      window.workbench.data.getModule('notificationHistory'),
    ]).then(([nextSettings, nextHistory]) => {
      setSettingsState(nextSettings);
      setHistory(nextHistory);
    }).catch(() => {});
  }, []);

  const persistSettings = useCallback(async (nextSettings: AppSettings) => {
    const revision = saveRevisionRef.current;
    try {
      await window.workbench.data.setSettings({
        profile: nextSettings.profile,
        agent: nextSettings.agent,
        netease: nextSettings.netease,
        notify: nextSettings.notify,
        sync: nextSettings.sync,
      });
      if (revision === saveRevisionRef.current) setSaveState('saved');
    } catch {
      if (revision === saveRevisionRef.current) setSaveState('error');
    }
  }, []);

  useEffect(() => {
    if (!settings || saveState !== 'saving') return;
    const timer = window.setTimeout(() => void persistSettings(settings), 650);
    return () => window.clearTimeout(timer);
  }, [settings, saveState, persistSettings]);

  if (!settings) {
    return (
      <section className="module-page">
        <h2 className="page-title">设置</h2>
        <p className="page-sub">读取设置中</p>
      </section>
    );
  }

  function update(patch: Partial<AppSettings>) {
    if (!settings) return;
    const next: AppSettings = {
      ...settings,
      ...patch,
      email: settings.email,
      profile: patch.profile ?? settings.profile,
      netease: patch.netease ?? settings.netease,
      notify: patch.notify ?? settings.notify,
      agent: patch.agent ?? settings.agent,
      sync: patch.sync ?? settings.sync,
    };
    setSettingsState(next);
    saveRevisionRef.current += 1;
    setSaveState('saving');
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    saveRevisionRef.current += 1;
    setSaveState('saving');
    void persistSettings(settings);
  }

  function toggleReminder(minutes: number) {
    if (!settings) return;
    const current = settings.notify.reminderMinutes;
    const next = current.includes(minutes)
      ? current.filter((item) => item !== minutes)
      : [...current, minutes].sort((a, b) => b - a);
    if (next.length) update({ notify: { ...settings.notify, reminderMinutes: next } });
  }

  return (
    <section className="module-page">
      <form id="settings-form" className="settings-grid" onSubmit={save}>
        <section className="settings-section" aria-labelledby="settings-form-title">
          <header className="settings-page-header">
            <div className="settings-page-heading">
              <span className="settings-eyebrow">设置</span>
              <h2 id="settings-form-title">{sectionInfo.title}</h2>
              <p>{sectionInfo.description}</p>
            </div>
            <span className={`settings-save-state ${saveState}`} role="status" aria-live="polite">
              {SAVE_STATE_LABEL[saveState]}
            </span>
          </header>
          <div className="settings-section-content">
          {section === 'settings-profile' && <>
          <section className="settings-subsection" aria-labelledby="profile-identity-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="profile-identity-title">个人身份</h3>
                <p>姓名、称呼和当前工作场景，帮助 Agent 读懂你的上下文。</p>
              </div>
            </div>
            <div className="settings-profile-identity">
              <div className="profile-avatar-card">
                <div className="profile-avatar-preview">
                  <div className="brand-avatar" aria-hidden="true" />
                </div>
                <div className="profile-avatar-copy">
                  <strong>头像</strong>
                  <span className="profile-avatar-action" title="头像上传功能即将支持">更换头像</span>
                  <small>JPG / PNG · 最大 5MB</small>
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

          <section className="settings-subsection" aria-labelledby="profile-context-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="profile-context-title">关于我</h3>
                <p>添加一些相对稳定的背景信息；近期任务放在当前重点里。</p>
              </div>
            </div>
            <label className="field">
              <span>关于我</span>
              <textarea
                rows={3}
                value={settings.profile.about}
                onChange={(event) => update({ profile: { ...settings.profile, about: event.target.value } })}
                placeholder="例如：我主要做桌面应用和自动化工具，平时负责产品设计、开发和文档整理。"
              />
              <small className="field-hint">可以填写职业、兴趣、长期背景等。</small>
            </label>
            <label className="field">
              <span>当前重点</span>
              <textarea
                rows={2}
                value={settings.profile.currentFocus}
                onChange={(event) => update({ profile: { ...settings.profile, currentFocus: event.target.value } })}
                placeholder="例如：目前正在完善个人工作台，优先处理待办、资料整理和 Agent 工作流。"
              />
              <small className="field-hint">写下当前最重要的一件事即可。</small>
            </label>
          </section>

          <section className="settings-subsection" aria-labelledby="profile-agent-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="profile-agent-title">Agent 工作方式</h3>
                <p>把常用的沟通习惯变成明确选项，减少重复说明。</p>
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

          <section className="settings-subsection" aria-labelledby="profile-rules-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="profile-rules-title">长期规则</h3>
                <p>长期有效的工作习惯或约束，每行一条。</p>
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
              <small className="field-hint">每行一条，写下你希望工作台长期遵循的习惯。</small>
            </label>
          </section>
          </>}

          {section === 'settings-notifications' && <>
          <fieldset className="notify-fieldset">
            <legend>截止提醒</legend>
            <p>在截止前发送桌面提醒；超期事项会额外尝试发送手机推送。</p>
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
          <p className="settings-detail-note">
            系统会自动识别法定节假日和 5·20 等常见日期；生日、纪念日等私人日期，直接在 Agent 对话里告诉它即可。
          </p>
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

          {settings.notify.channel === 'ntfy' && (
            <>
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
                手机安装 ntfy App → 点右下角订阅 → 输入同一个 topic 名称 → 完成。
              </p>
            </>
          )}

          {settings.notify.channel === 'bark' && (
            <>
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
                App Store 搜索 Bark 安装 → 打开 App 复制推送地址 → 粘贴到上面输入框 → 保存后回到待办页点「测试手机推送」验证。
              </p>
            </>
          )}
          {history.length > 0 && (
            <div className="notification-history" aria-label="最近通知">
              <p>最近通知</p>
              {history.slice(0, 5).map((item) => (
                <div key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.body} · {new Date(item.sentAt).toLocaleString('zh-CN', { hour12: false })}</span>
                </div>
              ))}
            </div>
          )}
          </>}

          {section === 'settings-config' && <>
          <section className="settings-subsection" aria-labelledby="agent-persona-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="agent-persona-title">身份与沟通</h3>
                <p>这些设定会用于普通对话、后台主动检查和主动消息；不会改变数据确认与安全边界。</p>
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
              <small className="field-hint">会显示在主动消息和桌面通知中；留空时使用「Agent」。</small>
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
              <small className="field-hint">写下希望它长期遵守的称呼、语气、协作习惯或表达偏好。</small>
            </label>
          </section>
          <section className="settings-subsection" aria-labelledby="agent-proactive-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="agent-proactive-title">主动发现</h3>
                <p>关闭后，Agent 不会在后台自动检查或发送主动跟进提醒。</p>
              </div>
            </div>
            <label className={`settings-toggle${settings.agent.proactiveEnabled !== false ? ' is-on' : ''}`}>
              <span className="settings-toggle-copy">
                <strong>启用主动建议</strong>
                <small>保留已有建议和运行记录，不影响手动聊天。</small>
              </span>
              <input
                type="checkbox"
                checked={settings.agent.proactiveEnabled !== false}
                onChange={(event) => update({ agent: { ...settings.agent, proactiveEnabled: event.target.checked } })}
                aria-label="启用主动建议"
              />
              <span className="settings-toggle-track" aria-hidden="true"><span /></span>
            </label>
          </section>
          <section className="settings-subsection" aria-labelledby="agent-service-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="agent-service-title">Agent 服务</h3>
                <p>连接模型服务时使用的地址、密钥和模型。</p>
              </div>
            </div>
            <label className="field">
              <span>API 地址</span>
              <input
                value={settings.agent.apiBase}
                onChange={(event) =>
                  update({ agent: { ...settings.agent, apiBase: event.target.value } })
                }
                placeholder="https://api.deepseek.com/v1"
              />
            </label>
            <label className="field">
              <span>API 密钥</span>
              <input
                type="password"
                value={settings.agent.apiKey}
                onChange={(event) =>
                  update({ agent: { ...settings.agent, apiKey: event.target.value } })
                }
                placeholder="sk-..."
              />
            </label>
            <label className="field">
              <span>模型</span>
              <input
                value={settings.agent.model}
                onChange={(event) =>
                  update({ agent: { ...settings.agent, model: event.target.value } })
                }
                placeholder="deepseek-chat"
              />
            </label>
          </section>
          <section className="settings-subsection" aria-labelledby="music-service-title">
            <div className="settings-subsection-head">
              <div>
                <h3 id="music-service-title">音乐服务</h3>
                <p>默认使用工作台内置音乐服务，打开应用时自动启动；也可以填入自己的兼容服务。</p>
              </div>
            </div>
            <label className="field">
              <span>服务地址（高级）</span>
                <input
                  value={settings.netease.apiBase}
                  onChange={(event) => update({ netease: { apiBase: event.target.value } })}
                  placeholder="http://127.0.0.1:3000"
                />
              <small className="field-hint">保留默认地址时由工作台自动管理，不需要手动启动网页或终端服务。</small>
            </label>
          </section>
          </>}
          </div>
        </section>
      </form>
    </section>
  );
}
