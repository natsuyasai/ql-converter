import jsQR from '../vendor/jsqr.mjs';
import { Assembler } from '../src/protocol.mjs';

const $ = (id) => document.getElementById(id);
const asm = new Assembler();
let stream = null;
let timer = null;
let saved = null; // { name, bytes } once verified
let last = { text: '', at: 0 };

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

async function handleText(text) {
  const now = Date.now();
  if (text === last.text && now - last.at < 1500) return;
  last = { text, at: now };
  const r = asm.add(text);
  if (r.status === 'added') message(`${r.seq}番を読み取りました`, 'ok');
  else if (r.status === 'duplicate') message('読み取り済みのQRです');
  else if (r.status === 'foreign') message('別のファイルのQRです。切り替える場合は「やり直し」を押してください', 'warn');
  else message('このツールのQRではありません', 'warn');
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
  const scale = Math.min(1, 960 / v.videoWidth);
  scanCanvas.width = Math.round(v.videoWidth * scale);
  scanCanvas.height = Math.round(v.videoHeight * scale);
  scanCtx.drawImage(v, 0, 0, scanCanvas.width, scanCanvas.height);
  const d = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
  const code = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
  if (code) handleText(code.data);
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
  timer = setInterval(scanFrame, 100);
}

async function readImage(file) {
  const bitmap = await createImageBitmap(file);
  scanCanvas.width = bitmap.width;
  scanCanvas.height = bitmap.height;
  scanCtx.drawImage(bitmap, 0, 0);
  const d = scanCtx.getImageData(0, 0, bitmap.width, bitmap.height);
  const code = jsQR(d.data, d.width, d.height);
  if (code) await handleText(code.data);
  else message('画像からQRコードを検出できませんでした', 'warn');
}

$('start').addEventListener('click', () => { if (!stream) startCamera(); });
$('reset').addEventListener('click', () => {
  stopCamera();
  asm.reset();
  saved = null;
  last = { text: '', at: 0 };
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
