const assert = require('node:assert/strict');

async function run() {
  const { isQuickCaptureShortcut, parseQuickCapture } = await import('../src/components/captureParser.ts');
  const now = new Date(2026, 7, 28, 16, 0, 0);

  assert.deepEqual(parseQuickCapture('/todo 整理作品集', now), {
    kind: 'todo', title: '整理作品集', content: '', start: null, due: null, error: null,
  });
  const event = parseQuickCapture('/event 明天 09:30 面试准备', now);
  assert.equal(event?.kind, 'event');
  assert.equal(event?.title, '面试准备');
  assert.equal(new Date(event?.start || '').getDate(), 29);
  assert.equal(new Date(event?.start || '').getHours(), 9);
  assert.equal(parseQuickCapture('/event 后天 09:30 面试准备', now)?.error?.includes('/event'), true);
  assert.equal(parseQuickCapture('/note 今天的复盘', now)?.content, '今天的复盘');
  assert.equal(parseQuickCapture('先保留这个灵感', now)?.kind, 'note');
  assert.equal(parseQuickCapture('/unknown 不保存', now)?.error?.includes('/todo'), true);
  assert.equal(isQuickCaptureShortcut({ defaultPrevented: false, repeat: false, altKey: false, metaKey: true, ctrlKey: false, key: 'k' }), true);
  assert.equal(isQuickCaptureShortcut({ defaultPrevented: false, repeat: false, altKey: false, metaKey: false, ctrlKey: true, key: 'K' }), true);
  assert.equal(isQuickCaptureShortcut({ defaultPrevented: false, repeat: false, altKey: true, metaKey: true, ctrlKey: false, key: 'k' }), false);
  process.stdout.write('quick capture self-test ok\n');
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
