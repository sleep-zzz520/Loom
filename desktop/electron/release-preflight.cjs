function isHttpsUpdateUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

const missing = [];
if (process.platform !== 'win32') missing.push('Windows 发布请在 Windows 构建机上执行');
if (!isHttpsUpdateUrl(process.env.LOOM_UPDATE_URL)) {
  missing.push('LOOM_UPDATE_URL（HTTPS 更新文件目录，不能含账号、查询参数或片段）');
}

if (missing.length) {
  console.error('release preflight failed:');
  missing.forEach((item) => console.error(`- ${item}`));
  console.error('凭据只通过本机环境变量或 CI secrets 提供，不能写入仓库。');
  process.exitCode = 1;
} else {
  console.log('release preflight ok');
}
