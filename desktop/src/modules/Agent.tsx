import { FormEvent, useEffect, useRef, useState } from 'react';
import { Send, Settings2, Sparkles } from 'lucide-react';
import type { AppSettings, ChatMessage } from '../types';

const SUGGESTIONS = ['明天提醒我学习', '后天下午安排一次散步', '记录一篇关于本周的笔记'];

export default function Agent({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.workbench.data
      .getSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, busy]);

  const configured = Boolean(
    settings?.agent.apiBase && settings.agent.apiKey && settings.agent.model
  );

  async function submit(text: string) {
    if (!text || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    setError('');
    try {
      const reply = await window.workbench.agent.chat(next);
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败，请稍后重试');
      setMessages(next);
    } finally {
      setBusy(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    await submit(draft);
  }

  return (
    <section className="module-page agent-page">
      <div className="agent-panel">
        <div className="agent-toolbar">
          <span className="agent-label">
            <Sparkles size={14} />
            工作台上下文已加载
          </span>
          <div className="agent-toolbar-actions">
            <span className="agent-status"><span className={configured ? 'status-dot on' : 'status-dot'} />{configured ? '已连接' : '未配置'}</span>
            {!configured && <button type="button" className="text-btn" onClick={onOpenSettings}><Settings2 size={15} /> 配置</button>}
          </div>
        </div>

        <div className="chat-list" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              <div className="placeholder-icon">
                <Sparkles size={18} />
              </div>
              <p>可以说出你想做的事，例如“明天提醒我学习”</p>
              <div className="suggestion-row">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="suggestion-btn"
                    onClick={() => setDraft(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message, index) => (
            <div key={`${index}-${message.role}`} className={`chat-msg ${message.role}`}>
              <div className="chat-bubble">{message.content}</div>
            </div>
          ))}
          {busy && (
            <div className="chat-msg assistant">
              <div className="chat-bubble waiting">处理中</div>
            </div>
          )}
        </div>

        {error && <p className="form-error chat-error">{error}</p>}

        <form className="chat-form" onSubmit={send}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit(draft);
              }
            }}
            placeholder="向 Agent 提问"
            rows={2}
          />
          <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>
            <Send size={15} />
            发送
          </button>
        </form>
      </div>
    </section>
  );
}
