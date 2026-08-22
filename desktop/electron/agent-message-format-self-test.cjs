const assert = require('node:assert/strict');

(async () => {
  const { parseAgentMessage } = await import('../src/components/agentMessageFormat.ts');
  const blocks = parseAgentMessage([
    '我可以帮您完成以下任务：',
    '',
    '**信息查询**',
    '- 查看待办事项',
    '- 查看日历中的待办日程',
    '',
    '1. 第一步',
    '2. 第二步',
    '',
    '```ts',
    'const ready = true;',
    '```',
  ].join('\n'));

  assert.deepEqual(blocks.map((block) => block.kind), ['paragraph', 'label', 'list', 'list', 'code']);
  assert.deepEqual(blocks[2], { kind: 'list', ordered: false, items: ['查看待办事项', '查看日历中的待办日程'] });
  assert.deepEqual(blocks[3], { kind: 'list', ordered: true, items: ['第一步', '第二步'] });
  assert.deepEqual(blocks[4], { kind: 'code', language: 'ts', text: 'const ready = true;' });
  console.log('agent message format self-test ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
