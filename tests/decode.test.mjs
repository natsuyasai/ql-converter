import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readBarcodes } from 'zxing-wasm/reader';
import jsQR from '../vendor/jsqr.mjs';
import { decodeAll, resize } from '../src/decode.mjs';
import { encodeTransfer } from '../src/protocol.mjs';
import { buildMatrices } from '../src/qr.mjs';
import { A4, planLayout, drawPage } from '../src/layout.mjs';

test('resize: halves dimensions and averages pixels', () => {
  const d = new Uint8ClampedArray(4 * 4).fill(0);
  d.set([100, 100, 100, 255, 200, 200, 200, 255, 0, 0, 0, 255, 100, 100, 100, 255]); // 2x2 source
  const r = resize(d, 2, 2, 2);
  assert.equal(r.width, 1);
  assert.equal(r.data[0], 100);
});

test('decodeAll: reads every QR of a generated page (zxing)', async () => {
  let seed = 1;
  const bytes = Uint8Array.from({ length: 6000 }, () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255);
  const t = await encodeTransfer(bytes, 'f.bin', { chunkChars: 150 });
  const { moduleCount, matrices } = buildMatrices(t.payloads, 'M');
  const plan = planLayout(moduleCount, t.total, { maxPerPage: 12 });
  const canvas = createCanvas(A4.width, A4.height);
  drawPage(canvas.getContext('2d'), plan, 0, matrices, { name: 'f.bin', total: t.total });
  const d = canvas.getContext('2d').getImageData(0, 0, A4.width, A4.height);
  const texts = await decodeAll({ readBarcodes, jsQR }, d.data, d.width, d.height);
  assert.equal(texts.length, Math.min(plan.perPage, t.total));
  for (const s of texts) assert.ok(t.payloads.includes(s));
});

// A phone photo of a monitor (dense codes, moire). Kept out of git; runs only if present.
const photo = new URL('../PXL_20261103_063619289.jpg', import.meta.url);
test('decodeAll: reads all 6 QRs of a real phone photo of a screen', { skip: !existsSync(photo) }, async () => {
  const img = await loadImage(photo.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const c = createCanvas(img.width, img.height);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, img.width, img.height);
  const texts = await decodeAll({ readBarcodes, jsQR }, d.data, d.width, d.height);
  assert.equal(texts.length, 6);
});
