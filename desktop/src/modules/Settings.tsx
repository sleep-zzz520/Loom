import { FormEvent, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { AppSettings } from '../types';

export default function Settings() {
  const [settings, setSettingsState] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.workbench.data
      .getSettings()
      .then(setSettingsState)
      .catch(() => {});
  }, []);

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
    setSaved(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    await window.workbench.data.setSettings({
      profile: settings.profile,
      agent: settings.agent,
      netease: settings.netease,
      notify: settings.notify,
      sync: settings.sync,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section className="module-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">设置</h2>
          <p className="page-sub">个人资料与 Agent 配置</p>
        </div>
        <button type="submit" form="settings-form" className="btn-primary">
          <Save size={15} />
          保存
        </button>
      </div>

      <form id="settings-form" className="settings-grid" onSubmit={save}>
        <div className="settings-section">
          <h3 className="settings-title">个人资料</h3>
          <label className="field">
            <span>姓名</span>
            <input
              value={settings.profile.name}
              onChange={(event) =>
                update({ profile: { ...settings.profile, name: event.target.value } })
              }
              placeholder="你的名字"
            />
          </label>
          <label className="field">
            <span>简介</span>
            <textarea
              rows={2}
              value={settings.profile.about}
              onChange={(event) =>
                update({ profile: { ...settings.profile, about: event.target.value } })
              }
              placeholder="几句话介绍自己"
            />
          </label>
          <label className="field">
            <span>偏好（每行一条）</span>
            <textarea
              rows={4}
              value={settings.profile.preferences.join('\n')}
              onChange={(event) =>
                update({
                  profile: {
                    ...settings.profile,
                    preferences: event.target.value
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="例如：工作日不要打扰我午休"
            />
          </label>
        </div>

        <div className="settings-section">
          <h3 className="settings-title">通知</h3>
          <p className="settings-hint">配置待办超期提醒的推送渠道，支持 ntfy 和 Bark（iOS 推荐）。</p>

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
              <p className="settings-hint" style={{ marginTop: 8 }}>
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
              <p className="settings-hint" style={{ marginTop: 8 }}>
                App Store 搜索 Bark 安装 → 打开 App 复制推送地址 → 粘贴到上面输入框 → 保存后回到待办页点「测试手机推送」验证。
              </p>
            </>
          )}
        </div>

        <div className="settings-section">
          <h3 className="settings-title">Agent 模型</h3>
          <p className="settings-hint">使用 OpenAI 兼容的 chat/completions 接口</p>
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
        </div>
      </form>

      {saved && <p className="save-note">已保存</p>}
    </section>
  );
}
