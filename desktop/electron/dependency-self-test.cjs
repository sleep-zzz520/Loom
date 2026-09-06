const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { test } = require('node:test');

// Resolve the copies used by the embedded server, including nested overrides.
const musicRequire = createRequire(require.resolve('NeteaseCloudMusicApi/server'));
const expressRequire = createRequire(musicRequire.resolve('express'));
const metadataRequire = createRequire(musicRequire.resolve('music-metadata'));

function runParser(code) {
  // A Promise timeout cannot interrupt a parser that monopolizes the event loop.
  const result = spawnSync(process.execPath, ['-e', code], {
    timeout: 4000,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /parser completed/);
}

test('qs handles parsed constructor.isBuffer values without crashing', () => {
  const qs = expressRequire('qs');
  const parsed = qs.parse('x[constructor][isBuffer]=y', { plainObjects: true });
  assert.doesNotThrow(() => qs.stringify(parsed));
});

test('qs enforces comma array limits for bracket keys', () => {
  const qs = expressRequire('qs');
  assert.throws(() => qs.parse('a[]=1,2,3,4', {
    comma: true, arrayLimit: 3, throwOnLimitExceeded: true,
  }), RangeError);
  assert.deepEqual(qs.parse('ids=1,2&limit=20'), { ids: '1,2', limit: '20' });
});

test('file-type terminates on an ASF sub-header with zero size', () => {
  runParser(`
    const api = require(${JSON.stringify(metadataRequire.resolve('file-type'))});
    const parse = api.fileTypeFromBuffer || api.fromBuffer;
    const input = Buffer.alloc(55);
    Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex').copy(input);
    parse(input).then(
      () => console.log('parser completed'),
      () => console.log('parser completed with invalid-input rejection'),
    );
  `);
});

test('music-metadata terminates on an ASF extension object with zero size', () => {
  runParser(`
    const api = require(${JSON.stringify(musicRequire.resolve('music-metadata'))});
    const input = Buffer.alloc(100);
    Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex').copy(input);
    input.writeBigUInt64LE(100n, 16);
    input.writeUInt32LE(1, 24);
    input[28] = 1;
    input[29] = 2;
    Buffer.from('b503bf5f2ea9cf118ee300c00c205365', 'hex').copy(input, 30);
    input.writeBigUInt64LE(70n, 46);
    input.writeUInt32LE(24, 72);
    Buffer.from('74d40618dfca0945a4ba9aabcb96aae8', 'hex').copy(input, 76);
    api.parseBuffer(input, 'audio/x-ms-asf').then(
      () => console.log('parser completed'),
      () => console.log('parser completed with invalid-input rejection'),
    );
  `);
});

test('the overridden metadata library still loads through CommonJS and parses WAV', async () => {
  const metadata = musicRequire('music-metadata');
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(38, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(2, 40);
  const result = await metadata.parseBuffer(wav, 'audio/wav');
  assert.equal(result.format.sampleRate, 8000);
  assert.equal(result.format.numberOfChannels, 1);
  assert.equal(typeof musicRequire('./module/cloud.js'), 'function');
});
