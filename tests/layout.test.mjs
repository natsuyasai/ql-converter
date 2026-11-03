import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMatrices } from '../src/qr.mjs';
import { A4, planLayout, drawPage } from '../src/layout.mjs';

test('buildMatrices: every matrix has the same size', () => {
  const { moduleCount, matrices } = buildMatrices(['a'.repeat(10), 'b'.repeat(300), 'c'.repeat(50)]);
  assert.equal(matrices.length, 3);
  for (const m of matrices) {
    assert.equal(m.length, moduleCount);
    for (const row of m) assert.equal(row.length, moduleCount);
  }
});

test('buildMatrices: throws when a payload exceeds QR capacity', () => {
  assert.throws(() => buildMatrices(['x'.repeat(5000)]));
});

test('planLayout: few small QRs fit on one page', () => {
  const plan = planLayout(45, 3);
  assert.ok(plan.perPage >= 3);
  assert.equal(plan.pageCount, 1);
});

test('planLayout: keeps modules readable and splits pages', () => {
  const plan = planLayout(100, 30);
  assert.ok(plan.modulePx >= 6);
  assert.ok(plan.perPage <= 12);
  assert.equal(plan.pageCount, Math.ceil(30 / plan.perPage));
});

test('planLayout: huge QRs still lay out (one per page when needed)', () => {
  const plan = planLayout(177, 5, { minModulePx: 6 });
  assert.ok(plan.perPage >= 1);
  assert.equal(plan.pageCount, Math.ceil(5 / plan.perPage));
});

test('planLayout: respects maxPerPage', () => {
  const plan = planLayout(45, 10, { maxPerPage: 1 });
  assert.equal(plan.perPage, 1);
  assert.equal(plan.pageCount, 10);
});

function mockCtx() {
  const calls = { dark: 0, texts: [] };
  const ctx = {
    fillStyle: '#000',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect() { if (ctx.fillStyle === '#000') calls.dark++; },
    fillText(t) { calls.texts.push(t); },
  };
  return { ctx, calls };
}

test('drawPage: draws one dark rect per dark module and labels each QR', () => {
  const payloads = ['QF1|aaaa', 'QF1|bbbbbbbbb', 'QF1|cc'];
  const { moduleCount, matrices } = buildMatrices(payloads);
  const plan = planLayout(moduleCount, matrices.length);
  const { ctx, calls } = mockCtx();
  drawPage(ctx, plan, 0, matrices, { name: 'f.bin', total: 3 });
  const dark = matrices.flat(2).filter(Boolean).length;
  assert.equal(calls.dark, dark);
  assert.ok(calls.texts.some((t) => t.includes('1/3')));
  assert.ok(calls.texts.some((t) => t.includes('3/3')));
  assert.ok(calls.texts.some((t) => t.includes('f.bin')));
});

test('drawPage: page 2 only draws its own QRs', () => {
  const { moduleCount, matrices } = buildMatrices(['a1', 'b2', 'c3']);
  const plan = planLayout(moduleCount, 3, { maxPerPage: 2 });
  const { ctx, calls } = mockCtx();
  drawPage(ctx, plan, 1, matrices, { name: 'f.bin', total: 3 });
  assert.equal(calls.dark, matrices[2].flat().filter(Boolean).length);
  assert.ok(calls.texts.some((t) => t.includes('3/3')));
  assert.ok(!calls.texts.some((t) => t.includes('1/3')));
});

test('A4 ratio is 210:297', () => {
  assert.ok(Math.abs(A4.width / A4.height - 210 / 297) < 0.001);
});
