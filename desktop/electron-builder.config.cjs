const isRelease = process.env.LOOM_RELEASE === '1';

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
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.productivity',
    // 本机构建必须显式无签名；正式发布则强制签名和公证，避免意外把未签名包发给用户。
    // electron-builder 26 将 macOS 的签名参数直接放在 mac 下；升级到 27 时需迁移到 mac.sign。
    identity: isRelease ? undefined : null,
    hardenedRuntime: isRelease,
    entitlements: isRelease ? 'build/entitlements.mac.plist' : undefined,
    entitlementsInherit: isRelease ? 'build/entitlements.mac.inherit.plist' : undefined,
    notarize: isRelease,
  },
  forceCodeSigning: isRelease,
};
