import type { ReactNode } from 'react';
import { parseAgentMessage } from './agentMessageFormat';

const INLINE_TOKEN = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|~~[^~\n]+?~~|\[[^\]\n]+\]\((?:https:\/\/|mailto:)[^\s)]+\)|\*[^*\n]+?\*|_[^_\n]+?_)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_TOKEN).filter(Boolean).map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={index}>{renderInline(token.slice(2, -2))}</strong>;
    }
    if (token.startsWith('__') && token.endsWith('__')) {
      return <strong key={index}>{renderInline(token.slice(2, -2))}</strong>;
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={index}>{token.slice(1, -1)}</code>;
    }
    if (token.startsWith('~~') && token.endsWith('~~')) {
      return <del key={index}>{renderInline(token.slice(2, -2))}</del>;
    }
    const link = token.match(/^\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^\s)]+)\)$/);
    if (link) {
      return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{renderInline(link[1])}</a>;
    }
    if (token.startsWith('*') && token.endsWith('*')) {
      return <em key={index}>{renderInline(token.slice(1, -1))}</em>;
    }
    if (token.startsWith('_') && token.endsWith('_')) {
      return <em key={index}>{renderInline(token.slice(1, -1))}</em>;
    }
    return token;
  });
}

function renderListItem(item: string) {
  const task = item.match(/^\[([ xX])\]\s+(.+)$/);
  if (!task) return renderInline(item);
  return (
    <>
      <span className={`agent-message-checkbox${task[1].toLowerCase() === 'x' ? ' is-checked' : ''}`} aria-hidden="true">{task[1].toLowerCase() === 'x' ? '✓' : ''}</span>
      {renderInline(task[2])}
    </>
  );
}

export default function AgentMessageContent({ content }: { content: string }) {
  const blocks = parseAgentMessage(content);
  return (
    <div className="agent-message-content">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          const Heading = `h${block.level}` as 'h1' | 'h2' | 'h3';
          return <Heading key={index}>{renderInline(block.text)}</Heading>;
        }
        if (block.kind === 'label') return <p key={index} className="agent-message-label">{renderInline(block.text)}</p>;
        if (block.kind === 'paragraph') return <p key={index}>{renderInline(block.text)}</p>;
        if (block.kind === 'quote') return <blockquote key={index}>{renderInline(block.text)}</blockquote>;
        if (block.kind === 'rule') return <hr key={index} />;
        if (block.kind === 'code') {
          return (
            <pre key={index}>
              {block.language && <span className="agent-message-code-language">{block.language}</span>}
              <code>{block.text}</code>
            </pre>
          );
        }
        const List = block.ordered ? 'ol' : 'ul';
        return (
          <List key={index}>
            {block.items.map((item, itemIndex) => {
              const task = /^\[([ xX])\]\s+/.test(item);
              return <li key={itemIndex} className={task ? 'agent-message-task' : undefined}>{renderListItem(item)}</li>;
            })}
          </List>
        );
      })}
    </div>
  );
}
