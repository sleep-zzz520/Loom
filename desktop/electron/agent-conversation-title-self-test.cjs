const assert = require('node:assert/strict');

(async () => {
  const {
    DEFAULT_CONVERSATION_TITLE,
    conversationTitle,
    conversationTitleFromMessages,
    isPlaceholderConversationTitle,
  } = await import('../src/components/agentConversationTitle.ts');

  assert.equal(conversationTitle('  整理本周的待办\n并标出高优先级  '), '整理本周的待办 并标出高优先级');
  assert.equal(conversationTitle('```ts\nconst title = true;\n```'), DEFAULT_CONVERSATION_TITLE);
  assert.equal(conversationTitleFromMessages([
    { role: 'assistant', content: '先告诉我你想处理什么。' },
    { role: 'user', content: '帮我准备周一的项目会议' },
  ]), '帮我准备周一的项目会议');
  assert.equal(conversationTitleFromMessages([
    { role: 'user', content: '```ts\nconst title = true;\n```' },
    { role: 'user', content: '再帮我整理成会议要点' },
  ]), '再帮我整理成会议要点');
  assert.equal(isPlaceholderConversationTitle('此前对话'), true);
  assert.equal(isPlaceholderConversationTitle('我的项目计划'), false);
  console.log('agent conversation title self-test ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
