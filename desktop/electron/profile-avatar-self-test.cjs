const assert = require('node:assert/strict');

(async () => {
  const { MAX_AVATAR_FILE_SIZE, avatarUploadError } = await import('../src/modules/profileAvatar.ts');
  assert.equal(avatarUploadError({ type: 'image/jpeg', size: 1 }), null);
  assert.equal(avatarUploadError({ type: 'image/png', size: MAX_AVATAR_FILE_SIZE }), null);
  assert.equal(avatarUploadError({ type: 'image/gif', size: 1 }), '请选择 JPG 或 PNG 图片。');
  assert.equal(avatarUploadError({ type: 'image/png', size: 0 }), '图片文件为空，请重新选择。');
  assert.equal(avatarUploadError({ type: 'image/png', size: MAX_AVATAR_FILE_SIZE + 1 }), '图片不能超过 5MB。');
  console.log('profile avatar self-test ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
