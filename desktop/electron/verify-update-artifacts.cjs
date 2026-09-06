const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'release');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const productName = 'Loom';
const version = String(packageJson.version || '').trim();
const metadataPath = path.join(outputDir, 'latest.yml');

const failures = [];
if (!version) failures.push('package.json 缺少版本号');
if (!fs.existsSync(metadataPath)) failures.push('缺少 latest.yml，应用内更新无法发现新版本');

const installerFiles = fs.existsSync(outputDir)
  ? fs.readdirSync(outputDir).filter((file) => new RegExp(`^${productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-Setup-${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[^/]+\\.exe$`).test(file))
  : [];
for (const file of installerFiles) {
  if (!fs.existsSync(path.join(outputDir, `${file}.blockmap`))) failures.push(`缺少 ${file}.blockmap`);
}
if (!installerFiles.length) failures.push('缺少 Windows NSIS 安装包');

let metadata = '';
if (fs.existsSync(metadataPath)) {
  metadata = fs.readFileSync(metadataPath, 'utf8');
  if (!metadata.includes(`version: ${version}`)) failures.push('latest.yml 的版本号与 package.json 不一致');
  if (!installerFiles.some((file) => metadata.includes(`url: ${file}`))) failures.push('latest.yml 没有引用当前构建的 Windows 安装包');
}

if (failures.length) {
  console.error('update artifact verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`update artifacts verified: ${installerFiles.join(', ')}, latest.yml`);
}
