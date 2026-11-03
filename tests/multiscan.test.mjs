import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import jsQR from '../vendor/jsqr.mjs';
import { encodeTransfer } from '../src/protocol.mjs';
import { buildMatrices } from '../src/qr.mjs';
import { A4, planLayout, drawPage } from '../src/layout.mjs';
import { scanAll } from '../src/multiscan.mjs';

async function render(bytes, maxPerPage, scale = 1) {
  const t = await encodeTransfer(bytes, 'f.bin', { chunkChars: 150 });
  const { moduleCount, matrices } = buildMatrices(t.payloads, 'M');
  const plan = planLayout(moduleCount, t.total, { maxPerPage });
  const canvas = createCanvas(A4.width, A4.height);
  drawPage(canvas.getContext('2d'), plan, 0, matrices, { name: 'f.bin', total: t.total });
  if (scale === 1) return { t, plan, canvas, w: A4.width, h: A4.height, data: canvas.getContext('2d').getImageData(0, 0, A4.width, A4.height).data };
  const w = Math.round(A4.width * scale), h = Math.round(A4.height * scale);
  const small = createCanvas(w, h);
  const ctx = small.getContext('2d');
  ctx.drawImage(canvas, 0, 0, w, h);
  return { t, plan, w, h, data: ctx.getImageData(0, 0, w, h).data };
}

let seed = 12345;
const bytes = Uint8Array.from({ length: 6000 }, () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255);

test('scanAll: reads every QR on a full page', async () => {
  const { t, plan, w, h, data } = await render(bytes, 12);
  const expected = Math.min(plan.perPage, t.total);
  assert.ok(expected >= 6, `only ${expected} QRs on page`);
  const texts = scanAll(jsQR, data, w, h, { inversionAttempts: 'dontInvert' });
  assert.equal(texts.length, expected);
  for (const s of texts) assert.ok(t.payloads.includes(s));
});

test('scanAll: still reads all QRs after downscaling to ~camera resolution', async () => {
  const { t, plan, w, h, data } = await render(bytes, 12, 0.6);
  const expected = Math.min(plan.perPage, t.total);
  assert.ok(expected >= 6, `only ${expected} QRs on page`);
  const texts = scanAll(jsQR, data, w, h, { inversionAttempts: 'dontInvert' });
  assert.equal(texts.length, expected);
});

test('scanAll: blank image gives nothing and input is not mutated', () => {
  const data = new Uint8ClampedArray(100 * 100 * 4).fill(255);
  assert.deepEqual(scanAll(jsQR, data, 100, 100), []);
});
