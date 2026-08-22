export const DEFAULT_CONVERSATION_TITLE = '新对话';

const PLACEHOLDER_TITLES = new Set(['', DEFAULT_CONVERSATION_TITLE, '此前对话']);

export function isPlaceholderConversationTitle(value: string | undefined) {
  return PLACEHOLDER_TITLES.has(String(value || '').trim());
}

export function conversationTitle(content: string) {
  const title = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) return DEFAULT_CONVERSATION_TITLE;
  return title.length > 26 ? `${title.slice(0, 26)}…` : title;
}

export function conversationTitleFromMessages(messages: Array<{ role?: string; content?: string }>) {
  const userMessages = messages.filter((message) => message?.role === 'user' && String(message.content || '').trim());
  const firstMeaningfulUserMessage = userMessages.find((message) => conversationTitle(String(message.content)) !== DEFAULT_CONVERSATION_TITLE);
  const firstMessage = messages.find((message) => String(message?.content || '').trim());
  return conversationTitle(String(firstMeaningfulUserMessage?.content || userMessages[0]?.content || firstMessage?.content || ''));
}
