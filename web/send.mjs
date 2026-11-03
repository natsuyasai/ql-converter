import { encodeTransfer } from '../src/protocol.mjs';
import { buildMatrices } from '../src/qr.mjs';
import { A4, planLayout, drawPage } from '../src/layout.mjs';

const $ = (id) => document.getElementById(id);
const drop = $('drop');
const fileInput = $('file');
let current = null; // { name, bytes }
let canvases = [];
let runId = 0;

function say(text, cls = '') {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.textContent = text;
  $('status').append(div);
}

function pngName(name, i, count) {
  return count === 1 ? `${name}.qr.png` : `${name}.qr-${i + 1}.png`;
}

function save(canvas, filename) {
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

async function generate() {
  if (!current) return;
  const id = ++runId;
  $('status').replaceChildren();
  $('pages').replaceChildren();
  $('actions').hidden = true;
  canvases = [];
  say('QRコードを生成中…', 'busy');
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
  if (id !== runId) return;
  try {
    const chunkChars = Number($('chunk').value) || 600;
    const t = await encodeTransfer(current.bytes, current.name, { chunkChars });
    const { moduleCount, matrices } = buildMatrices(t.payloads, $('ec').value);
    const plan = planLayout(moduleCount, t.total, { maxPerPage: Number($('perPage').value) || 12 });
    if (id !== runId) return;
    $('status').replaceChildren();
    t.warnings.forEach((w) => say(w, 'warn'));
    say(`${current.name}: QR ${t.total}枚 / ${plan.pageCount}ページ`, 'ok');
    for (let p = 0; p < plan.pageCount; p++) {
      const canvas = document.createElement('canvas');
      canvas.width = A4.width;
      canvas.height = A4.height;
      drawPage(canvas.getContext('2d'), plan, p, matrices, { name: current.name, total: t.total });
      canvases.push(canvas);
      const wrap = document.createElement('div');
      wrap.className = 'page';
      const bar = document.createElement('div');
      bar.className = 'bar';
      const label = document.createElement('span');
      label.textContent = `ページ ${p + 1}/${plan.pageCount}`;
      const btn = document.createElement('button');
      btn.textContent = 'PNG保存';
      btn.addEventListener('click', () => save(canvas, pngName(current.name, p, plan.pageCount)));
      bar.append(label, btn);
      wrap.append(canvas, bar);
      $('pages').append(wrap);
    }
    $('actions').hidden = false;
  } catch (e) {
    say(e.message, 'err');
  }
}

async function load(file) {
  if (!file) return;
  current = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  await generate();
}

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', () => load(fileInput.files[0]));
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  load(e.dataTransfer.files[0]);
});
for (const id of ['ec', 'chunk', 'perPage']) $(id).addEventListener('change', generate);
$('saveAll').addEventListener('click', () => {
  canvases.forEach((c, i) => setTimeout(() => save(c, pngName(current.name, i, canvases.length)), i * 300));
});
