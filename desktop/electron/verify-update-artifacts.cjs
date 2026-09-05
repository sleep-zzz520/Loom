const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'release');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const productName = 'Loom';
const version = String(packageJson.version || '').trim();
const metadataPath = path.join(outputDir, 'latest-mac.yml');

const failures = [];
if (!version) failures.push('package.json 缺少版本号');
if (!fs.existsSync(metadataPath)) failures.push('缺少 latest-mac.yml，应用内更新无法发现新版本');

const zipFiles = fs.existsSync(outputDir)
  ? fs.readdirSync(outputDir).filter((file) => new RegExp(`^${productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[^/]+\\.zip$`).test(file))
  : [];
if (!zipFiles.length) failures.push('缺少 macOS 更新 ZIP');

let metadata = '';
if (fs.existsSync(metadataPath)) {
  metadata = fs.readFileSync(metadataPath, 'utf8');
  if (!metadata.includes(`version: ${version}`)) failures.push('latest-mac.yml 的版本号与 package.json 不一致');
  if (!zipFiles.some((file) => metadata.includes(`url: ${file}`))) failures.push('latest-mac.yml 没有引用当前构建的更新 ZIP');
}

if (failures.length) {
  console.error('update artifact verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`update artifacts verified: ${zipFiles.join(', ')}, latest-mac.yml`);
}
