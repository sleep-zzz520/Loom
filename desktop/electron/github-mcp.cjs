const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');

const ENDPOINT = 'https://api.githubcopilot.com/mcp/';
const READ_TOOLS = new Set([
  'get_me', 'search_repositories', 'get_file_contents', 'get_repository_tree',
  'list_issues', 'issue_read', 'search_issues',
  'list_pull_requests', 'pull_request_read', 'search_pull_requests',
]);
const WRITE_TOOL = 'issue_write';
const SERVER_TOOLS = [...READ_TOOLS, WRITE_TOOL].join(',');

function configured(settings) {
  return settings?.github?.enabled === true && Boolean(settings.github.token);
}

function safeToolResult(result) {
  const content = Array.isArray(result?.content)
    ? result.content.flatMap((item) => {
      if (item?.type === 'text' && typeof item.text === 'string') return [item.text];
      if (item?.type === 'resource' && typeof item.resource?.text === 'string') return [item.resource.text];
      return [];
    }).join('\n')
    : '';
  const value = result?.structuredContent ?? content;
  const serialised = typeof value === 'string' ? value : JSON.stringify(value);
  return { error: result?.isError === true, content: String(serialised || '').slice(0, 16000) };
}

function normaliseIssueCreate(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || args.method !== 'create') return null;
  const owner = String(args.owner || '').trim();
  const repo = String(args.repo || '').trim();
  const title = String(args.title || '').trim();
  const body = String(args.body || '').trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)
    || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)
    || !title || title.length > 256 || body.length > 20000) return null;
  return { method: 'create', owner, repo, title, body };
}

function normaliseProposal(proposal) {
  if (proposal?.kind !== 'github_create_issue') return null;
  const args = normaliseIssueCreate(proposal.arguments);
  return args ? { kind: 'github_create_issue', arguments: args } : null;
}

function modelTool(tool) {
  if (tool.name === WRITE_TOOL) {
    return {
      type: 'function',
      function: {
        name: 'github__create_issue',
        description: '在 GitHub 仓库创建 issue。只生成确认卡片，用户确认后才会真正创建。',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: '仓库所有者' },
            repo: { type: 'string', description: '仓库名称' },
            title: { type: 'string', description: 'Issue 标题' },
            body: { type: 'string', description: 'Issue 正文' },
          },
          required: ['owner', 'repo', 'title'],
        },
      },
    };
  }
  return {
    type: 'function',
    function: {
      name: `github__${tool.name}`,
      description: `GitHub：${tool.description || tool.name}`.slice(0, 900),
      parameters: tool.inputSchema,
    },
  };
}

async function connect(settings) {
  if (!configured(settings)) return null;
  const token = settings.github.token;
  const client = new Client({ name: 'loom', version: '0.2.0' });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-MCP-Tools': SERVER_TOOLS,
      },
    },
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const tools = listed.tools.filter((tool) => READ_TOOLS.has(tool.name) || tool.name === WRITE_TOOL);
    return {
      tools: tools.map(modelTool),
      names: new Set(tools.map((tool) => tool.name)),
      async call(name, args) {
        if (!READ_TOOLS.has(name) || !this.names.has(name)) throw new Error('GitHub 读取工具不可用');
        return safeToolResult(await client.callTool({ name, arguments: args }));
      },
      async createIssue(args) {
        if (!this.names.has(WRITE_TOOL)) throw new Error('GitHub 创建 issue 工具不可用');
        const safeArgs = normaliseIssueCreate(args);
        if (!safeArgs) throw new Error('GitHub issue 内容无效');
        const result = safeToolResult(await client.callTool({ name: WRITE_TOOL, arguments: safeArgs }));
        if (result.error) throw new Error(`GitHub 创建 issue 失败：${result.content.slice(0, 500)}`);
        return result.content;
      },
      close: () => client.close(),
    };
  } catch {
    await client.close().catch(() => {});
    throw new Error('GitHub MCP 连接失败，请检查访问令牌、网络和 GitHub 权限');
  }
}

async function status(settings) {
  const enabled = settings?.github?.enabled === true;
  const tokenConfigured = Boolean(settings?.github?.token);
  if (!enabled || !tokenConfigured) {
    return { connected: false, enabled, tokenConfigured, toolCount: 0,
      message: tokenConfigured ? '令牌已保存，启用后可测试连接' : '尚未保存访问令牌' };
  }
  let session;
  try {
    session = await connect(settings);
    return { connected: true, enabled, tokenConfigured, toolCount: session.tools.length, message: 'GitHub 已连接' };
  } catch (error) {
    return { connected: false, enabled, tokenConfigured, toolCount: 0,
      message: error instanceof Error ? error.message : 'GitHub 连接失败' };
  } finally {
    await session?.close();
  }
}

module.exports = { connect, status, normaliseIssueCreate, normaliseProposal, safeToolResult, READ_TOOLS };
