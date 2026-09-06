const isRelease = process.env.LOOM_RELEASE === '1';

function updateFeedUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return '';
  }
}

const releaseUpdateUrl = updateFeedUrl(process.env.LOOM_UPDATE_URL);
if (isRelease && !releaseUpdateUrl) {
  throw new Error('正式发布需要 LOOM_UPDATE_URL：指向 HTTPS 更新文件目录的公开地址。');
}

module.exports = {
  appId: 'com.mumu.loom',
  productName: 'Loom',
  asar: true,
  // 该依赖通过动态路径加载其路由模块；保留在 asar 外可避免发布版出现动态 require 路径问题。
  asarUnpack: ['node_modules/NeteaseCloudMusicApi/**'],
  directories: {
    output: 'release',
  },
  files: [
    'dist/**/*',
    'electron/**/*',
  ],
  artifactName: '${productName}-${version}-${arch}.${ext}',
  // 正式包写入固定更新源；运行时不会从用户设置读取更新地址，避免更新来源被篡改。
  publish: null,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: '${productName}-Setup-${version}-${arch}.${ext}',
    publish: isRelease ? [{ provider: 'generic', url: releaseUpdateUrl }] : null,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
  },
  mac: {
    target: ['dmg'],
    minimumSystemVersion: '13.0.0',
    category: 'public.app-category.productivity',
    // macOS 暂不签名、公证或接入应用内更新，使用 DMG 手动安装。
    identity: null,
    hardenedRuntime: false,
    notarize: false,
    publish: null,
  },
  forceCodeSigning: false,
};
