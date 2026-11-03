import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { zipSync } from '../vendor/fflate.mjs';
import {
  MAX_INPUT_BYTES,
  WARN_INPUT_BYTES,
  encodeTransfer,
  parsePayload,
  Assembler,
  sanitizeFileName,
} from '../src/protocol.mjs';

async function receiveAll(payloads) {
  const asm = new Assembler();
  for (const p of payloads) asm.add(p);
  return asm.finish();
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

test('roundtrip: binary payload', async () => {
  const bytes = new Uint8Array(randomBytes(1000));
  const { payloads } = await encodeTransfer(bytes, 'data.bin');
  const out = await receiveAll(payloads);
  assert.deepEqual(out.bytes, bytes);
  assert.equal(out.name, 'data.bin');
});

test('roundtrip: shuffled order with duplicates', async () => {
  const bytes = new Uint8Array(randomBytes(3000));
  const { payloads, total } = await encodeTransfer(bytes, 'a.bin', { chunkChars: 200 });
  assert.ok(total > 3);
  const asm = new Assembler();
  const order = shuffled(payloads);
  assert.equal(asm.add(order[0]).status, 'added');
  assert.equal(asm.add(order[0]).status, 'duplicate');
  for (const p of order.slice(1)) asm.add(p);
  assert.equal(asm.complete, true);
  assert.deepEqual((await asm.finish()).bytes, bytes);
});

test('roundtrip: empty file', async () => {
  const { payloads, total } = await encodeTransfer(new Uint8Array(0), 'empty.txt');
  assert.ok(total >= 1);
  const out = await receiveAll(payloads);
  assert.equal(out.bytes.length, 0);
  assert.equal(out.name, 'empty.txt');
});

test('roundtrip: unicode filename is parsed intact and saved safely', async () => {
  const name = '日本語 🎉/a:b.txt';
  const { payloads } = await encodeTransfer(new TextEncoder().encode('x'), name);
  assert.equal(parsePayload(payloads[0]).name, name);
  const out = await receiveAll(payloads);
  assert.equal(out.name, sanitizeFileName(name));
  assert.ok(!/[\/\\:]/.test(out.name));
});

test('incompressible data uses z=0 and roundtrips', async () => {
  const bytes = new Uint8Array(randomBytes(2000));
  const t = await encodeTransfer(bytes, 'r.bin');
  assert.equal(t.compressed, false);
  assert.deepEqual((await receiveAll(t.payloads)).bytes, bytes);

  const zip = zipSync({ 'f.bin': new Uint8Array(randomBytes(2000)) });
  const t2 = await encodeTransfer(zip, 'x.zip');
  assert.deepEqual((await receiveAll(t2.payloads)).bytes, zip);
});

test('compressible data is smaller than raw', async () => {
  const bytes = new TextEncoder().encode('abcdefgh'.repeat(2500));
  const t = await encodeTransfer(bytes, 'rep.txt', { chunkChars: 600 });
  assert.equal(t.compressed, true);
  const rawChunks = Math.ceil((bytes.length * 4) / 3 / 600);
  assert.ok(t.total < rawChunks);
});

test('missing chunk: not complete, reports missing, finish throws', async () => {
  const bytes = new Uint8Array(randomBytes(2000));
  const { payloads } = await encodeTransfer(bytes, 'm.bin', { chunkChars: 200 });
  const asm = new Assembler();
  payloads.forEach((p, i) => { if (i !== 2) asm.add(p); });
  assert.equal(asm.complete, false);
  assert.deepEqual(asm.progress.missing, [3]);
  await assert.rejects(() => asm.finish());
});

test('foreign transfer is rejected without changing progress', async () => {
  const a = await encodeTransfer(new Uint8Array(randomBytes(500)), 'a.bin', { chunkChars: 100 });
  const b = await encodeTransfer(new Uint8Array(randomBytes(500)), 'b.bin', { chunkChars: 100 });
  const asm = new Assembler();
  asm.add(a.payloads[0]);
  assert.equal(asm.add(b.payloads[1]).status, 'foreign');
  assert.equal(asm.progress.received, 1);
});

test('garbage input is invalid and does not throw', () => {
  const asm = new Assembler();
  assert.equal(asm.add('https://example.com').status, 'invalid');
  assert.equal(asm.add('QF1|broken').status, 'invalid');
  assert.equal(asm.add('').status, 'invalid');
  assert.equal(asm.progress, null);
});

test('tampered data fails hash check', async () => {
  const bytes = new Uint8Array(randomBytes(1500));
  const { payloads } = await encodeTransfer(bytes, 't.bin', { chunkChars: 300 });
  const parts = payloads[1].split('|');
  const data = parts[6];
  parts[6] = (data[0] === 'A' ? 'B' : 'A') + data.slice(1);
  const asm = new Assembler();
  payloads.forEach((p, i) => asm.add(i === 1 ? parts.join('|') : p));
  assert.equal(asm.complete, true);
  await assert.rejects(() => asm.finish());
});

test('size limits', async () => {
  await assert.rejects(() => encodeTransfer(new Uint8Array(MAX_INPUT_BYTES + 1), 'big.bin'));
  const t = await encodeTransfer(new Uint8Array(WARN_INPUT_BYTES), 'w.bin');
  assert.ok(t.warnings.length >= 1);
});

test('capacity boundary: exact chunk length yields exact count', async () => {
  // incompressible 450 bytes -> 600 base64 chars (no padding) at chunkChars=600
  const bytes = new Uint8Array(randomBytes(450));
  const one = await encodeTransfer(bytes, 'b.bin', { chunkChars: 600 });
  assert.equal(one.total, 1);
  const bytes2 = new Uint8Array(randomBytes(451));
  const two = await encodeTransfer(bytes2, 'b.bin', { chunkChars: 600 });
  assert.equal(two.total, 2);
  assert.deepEqual((await receiveAll(two.payloads)).bytes, bytes2);
});

test('sanitizeFileName strips path and reserved characters', () => {
  assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFileName('a<b>c.txt'), 'a_b_c.txt');
  assert.equal(sanitizeFileName(''), 'download.bin');
  assert.equal(sanitizeFileName('C:\\x\\y.txt'), 'y.txt');
});
