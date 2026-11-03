import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import jsQR from '../vendor/jsqr.mjs';
import { Assembler } from '../src/protocol.mjs';
import { makeQrImages } from '../cli/make-qr.mjs';

async function tmpFile(name, bytes) {
  const dir = await mkdtemp(join(tmpdir(), 'qrtest-'));
  const p = join(dir, name);
  await writeFile(p, bytes);
  return { dir, p };
}

async function decodePng(file) {
  const img = await loadImage(file);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height);
  const code = jsQR(d.data, d.width, d.height);
  return code?.data ?? null;
}

test('end-to-end: PNGs decode back to the original file', async () => {
  const bytes = randomBytes(5000);
  const { dir, p } = await tmpFile('src.bin', bytes);
  const { files, total } = await makeQrImages(p, { out: join(dir, 'out.png'), maxPerPage: 1 });
  assert.equal(files.length, total);
  const asm = new Assembler();
  for (const f of files) {
    const text = await decodePng(f);
    assert.ok(text, `could not decode ${f}`);
    assert.equal(asm.add(text).status, 'added');
  }
  const out = await asm.finish();
  assert.equal(out.name, 'src.bin');
  assert.deepEqual(Buffer.from(out.bytes), bytes);
});

test('naming: single page uses out as given, multiple pages are numbered', async () => {
  const small = await tmpFile('s.txt', Buffer.from('hello'));
  const r1 = await makeQrImages(small.p, { out: join(small.dir, 'out.png') });
  assert.deepEqual(r1.files.map((f) => basename(f)), ['out.png']);

  const big = await tmpFile('b.bin', randomBytes(5000));
  const r2 = await makeQrImages(big.p, { out: join(big.dir, 'out.png'), maxPerPage: 3 });
  assert.ok(r2.files.length > 1);
  assert.deepEqual(r2.files.map((f) => basename(f)).slice(0, 2), ['out-1.png', 'out-2.png']);
  await assert.rejects(() => access(join(big.dir, 'out.png')));
});

test('empty file produces one QR image', async () => {
  const e = await tmpFile('e.txt', Buffer.alloc(0));
  const r = await makeQrImages(e.p, { out: join(e.dir, 'e.png') });
  assert.equal(r.files.length, 1);
  assert.ok((await readFile(r.files[0])).length > 0);
});

test('rejects oversized files without writing output', async () => {
  const big = await tmpFile('huge.bin', Buffer.alloc(257 * 1024, 1));
  await assert.rejects(() => makeQrImages(big.p, { out: join(big.dir, 'o.png') }));
  await assert.rejects(() => access(join(big.dir, 'o.png')));
});
