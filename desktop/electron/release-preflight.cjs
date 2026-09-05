const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const iconPath = path.join(root, 'build', 'icon.icns');
const hasSigningIdentity = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const hasAppleIdCredentials = Boolean(
  process.env.APPLE_ID
  && process.env.APPLE_APP_SPECIFIC_PASSWORD
  && process.env.APPLE_TEAM_ID
);
const hasApiKeyCredentials = Boolean(
  process.env.APPLE_API_KEY
  && process.env.APPLE_API_KEY_ID
  && process.env.APPLE_API_ISSUER
  && process.env.APPLE_TEAM_ID
);
const hasKeychainProfile = Boolean(process.env.APPLE_KEYCHAIN_PROFILE && process.env.APPLE_TEAM_ID);

function isHttpsUpdateUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

const missing = [];
if (process.platform !== 'darwin') missing.push('正式 macOS 发布必须在 macOS 构建机上执行');
if (!fs.existsSync(iconPath)) missing.push('desktop/build/icon.icns（正式 Loom 图标）');
if (!hasSigningIdentity) missing.push('CSC_LINK 或 CSC_NAME（Developer ID Application 签名证书）');
if (!hasAppleIdCredentials && !hasApiKeyCredentials && !hasKeychainProfile) {
  missing.push('Apple 公证凭据（Apple ID、App Store Connect API Key 或 Keychain Profile 之一）');
}
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
