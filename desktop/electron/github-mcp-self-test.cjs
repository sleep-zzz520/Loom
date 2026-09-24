const assert = require('node:assert/strict');
const github = require('./github-mcp.cjs');
const { runAgent } = require('./agent.cjs');

function stream(chunks) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: async () => index < chunks.length
      ? { done: false, value: encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: chunks[index++] }] })}\n\n`) }
      : { done: true, value: undefined } }) },
  };
}

void (async () => {
  assert.equal(github.normaliseIssueCreate({ method: 'update', owner: 'alice', repo: 'demo', title: 'x' }), null);
  assert.deepEqual(github.normaliseIssueCreate({ method: 'create', owner: 'alice', repo: 'demo', title: 'Bug' }), {
    method: 'create', owner: 'alice', repo: 'demo', title: 'Bug', body: '',
  });
  assert.equal(github.normaliseProposal({ kind: 'github_create_issue', arguments: { method: 'update' } }), null);
  assert.deepEqual(github.safeToolResult({ content: [{ type: 'text', text: 'ok' }] }), { error: false, content: 'ok' });
  assert.deepEqual(github.safeToolResult({ content: [
    { type: 'text', text: 'successfully downloaded text file' },
    { type: 'resource', resource: { uri: 'repo://alice/demo/contents/README.md', mimeType: 'text/plain', text: '# Demo\nBody' } },
  ] }), { error: false, content: 'successfully downloaded text file\n# Demo\nBody' });
  assert.equal(github.safeToolResult({ content: [{ type: 'resource', resource: { blob: 'YWJj' } }] }).content, '');
  assert.deepEqual(await github.status({ github: { enabled: false, token: 'saved-token' } }), {
    connected: false, enabled: false, tokenConfigured: true, toolCount: 0,
    message: '令牌已保存，启用后可测试连接',
  });
  assert.equal((await github.status({ github: { enabled: true, token: '' } })).tokenConfigured, false);

  const previousFetch = global.fetch;
  const calls = [];
  const session = {
    tools: [{ type: 'function', function: { name: 'github__list_issues', description: 'List', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'github__create_issue', description: 'Create', parameters: { type: 'object', properties: {} } } }],
    names: new Set(['list_issues', 'issue_write']),
    call: async (name, args) => {
      calls.push({ name, args });
      return { error: false, content: '[{"number":1,"title":"Bug"}]' };
    },
  };
  const settings = { agent: { apiBase: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' }, profile: {}, notify: {} };
  try {
    let requests = 0;
    global.fetch = async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.tools.some((tool) => tool.function.name === 'github__list_issues'), true);
      requests += 1;
      return requests === 1
        ? stream([{ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'github__list_issues', arguments: '{"owner":"alice","repo":"demo"}' } }] }])
        : stream([{ content: '找到了 1 条 issue。' }]);
    };
    const reply = await runAgent([{ role: 'user', content: '查看 alice/demo 的 issue' }], settings, () => {}, { githubSession: session });
    assert.equal(reply.content, '找到了 1 条 issue。');
    assert.deepEqual(calls, [{ name: 'list_issues', args: { owner: 'alice', repo: 'demo' } }]);

    global.fetch = async () => stream([{ tool_calls: [{ index: 0, id: 'call-2', type: 'function', function: {
      name: 'github__create_issue', arguments: '{"owner":"alice","repo":"demo","title":"修复登录","body":"复现步骤"}',
    } }] }]);
    const proposal = await runAgent([{ role: 'user', content: '在 alice/demo 创建 issue' }], settings, () => {}, { githubSession: session });
    assert.equal(proposal.proposal.kind, 'github_create_issue');
    assert.equal(proposal.proposal.arguments.method, 'create');
    assert.equal(calls.length, 1, '创建操作在确认前不能调用 MCP');

    let modelRequests = 0;
    session.call = async (name) => {
      assert.equal(name, 'get_file_contents');
      return github.safeToolResult({ content: [
        { type: 'text', text: 'successfully downloaded text file' },
        { type: 'resource', resource: { uri: 'repo://alice/demo/contents/README.md', text: '# Demo\nBody' } },
      ] });
    };
    session.tools.push({ type: 'function', function: { name: 'github__get_file_contents', description: 'Read file', parameters: { type: 'object', properties: {} } } });
    session.names.add('get_file_contents');
    global.fetch = async (_url, request) => {
      const body = JSON.parse(request.body);
      modelRequests += 1;
      if (modelRequests === 1) {
        return stream([{ tool_calls: [{ index: 0, id: 'call-3', type: 'function', function: {
          name: 'github__get_file_contents', arguments: '{"owner":"alice","repo":"demo","path":"README.md"}',
        } }] }]);
      }
      assert.equal(body.messages.some((message) => message.role === 'tool' && JSON.parse(message.content).content.includes('# Demo\nBody')), true,
        '嵌入资源正文必须进入下一轮模型上下文');
      return stream([{ content: 'README 的首个标题是 Demo。' }]);
    };
    const fileReply = await runAgent([{ role: 'user', content: '读取 README 标题' }], settings, () => {}, { githubSession: session });
    assert.equal(fileReply.content, 'README 的首个标题是 Demo。');
    assert.equal(modelRequests, 2);
    console.log('github mcp self-test ok');
  } finally {
    global.fetch = previousFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
