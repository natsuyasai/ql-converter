import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from '../vendor/fflate.mjs';
import qrcode from '../vendor/qrcode-generator.mjs';
import jsQR from '../vendor/jsqr.mjs';

test('fflate deflate/inflate roundtrip', () => {
  const data = new TextEncoder().encode('hello hello hello hello');
  assert.deepEqual(inflateSync(deflateSync(data)), data);
});

test('qrcode-generator builds a matrix', () => {
  const qr = qrcode(0, 'M');
  qr.addData('hi');
  qr.make();
  const n = qr.getModuleCount();
  assert.ok(Number.isInteger(n) && n > 0);
});

test('jsqr is a function', () => {
  assert.equal(typeof jsQR, 'function');
});
