import jsQR from '../vendor/jsqr.mjs';
import { Assembler } from '../src/protocol.mjs';
import { scanAll } from '../src/multiscan.mjs';

const $ = (id) => document.getElementById(id);
const asm = new Assembler();
let stream = null;
let timer = null;
let saved = null; // { name, bytes } once verified
const seen = new Map(); // text -> last time seen, to quiet repeats while the camera lingers

const scanCanvas = document.createElement('canvas');
const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });

function message(text, cls = '') {
  const el = $('message');
  el.textContent = text;
  el.className = `msg ${cls}`;
}

function render() {
  const p = asm.progress;
  $('info').hidden = !p;
  if (!p) return;
  $('name').textContent = p.name;
  $('bar').max = p.total;
  $('bar').value = p.received;
  $('count').textContent = `${p.received} / ${p.total} 枚`;
  const missing = new Set(p.missing);
  const cells = [];
  for (let i = 1; i <= p.total; i++) {
    const c = document.createElement('span');
    c.className = missing.has(i) ? 'cell' : 'cell got';
    c.textContent = i;
    cells.push(c);
  }
  $('grid').replaceChildren(...cells);
}

function stopCamera() {
  clearInterval(timer);
  timer = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $('video').hidden = true;
}

async function handleTexts(texts) {
  const now = Date.now();
  const fresh = texts.filter((t) => !(seen.has(t) && now - seen.get(t) < 1500));
  for (const t of texts) seen.set(t, now);
  if (!fresh.length) return;
  const added = [];
  let dup = 0, foreign = 0, invalid = 0;
  for (const text of fresh) {
    const r = asm.add(text);
    if (r.status === 'added') added.push(r.seq);
    else if (r.status === 'duplicate') dup++;
    else if (r.status === 'foreign') foreign++;
    else invalid++;
  }
  if (added.length) message(`${added.sort((a, b) => a - b).join(', ')}番を読み取りました(${added.length}枚)`, 'ok');
  else if (foreign) message('別のファイルのQRです。切り替える場合は「やり直し」を押してください', 'warn');
  else if (invalid) message('このツールのQRではありません', 'warn');
  else if (dup) message('読み取り済みのQRです');
  render();
  if (asm.complete && !saved) {
    stopCamera();
    try {
      saved = await asm.finish();
      message(`完了: ${saved.name}(${saved.bytes.length}バイト)`, 'ok');
      $('result').hidden = false;
    } catch (e) {
      message(e.message, 'err');
    }
  }
}

function scanFrame() {
  const v = $('video');
  if (!v.videoWidth) return;
  const scale = Math.min(1, 1920 / v.videoWidth);
  scanCanvas.width = Math.round(v.videoWidth * scale);
  scanCanvas.height = Math.round(v.videoHeight * scale);
  scanCtx.drawImage(v, 0, 0, scanCanvas.width, scanCanvas.height);
  const d = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
  const texts = scanAll(jsQR, d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
  if (texts.length) handleTexts(texts);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    message('カメラを使えません。HTTPS(または localhost)で開いてください', 'err');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (e) {
    message(e.name === 'NotAllowedError'
      ? 'カメラの使用が許可されていません。ブラウザの設定でカメラを許可してください'
      : `カメラを開始できません: ${e.message}`, 'err');
    return;
  }
  const v = $('video');
  v.srcObject = stream;
  v.hidden = false;
  await v.play();
  message('QRコードにカメラを向けてください');
  timer = setInterval(scanFrame, 300);
}

async function readImage(file) {
  const bitmap = await createImageBitmap(file);
  scanCanvas.width = bitmap.width;
  scanCanvas.height = bitmap.height;
  scanCtx.drawImage(bitmap, 0, 0);
  const d = scanCtx.getImageData(0, 0, bitmap.width, bitmap.height);
  const texts = scanAll(jsQR, d.data, d.width, d.height);
  if (texts.length) await handleTexts(texts);
  else message('画像からQRコードを検出できませんでした', 'warn');
}

$('start').addEventListener('click', () => { if (!stream) startCamera(); });
$('reset').addEventListener('click', () => {
  stopCamera();
  asm.reset();
  saved = null;
  seen.clear();
  $('result').hidden = true;
  message('');
  render();
});
$('image').addEventListener('change', async (e) => {
  for (const f of e.target.files) await readImage(f);
  e.target.value = '';
});
$('download').addEventListener('click', () => {
  if (!saved) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([saved.bytes]));
  a.download = saved.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
