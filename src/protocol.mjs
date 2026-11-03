// Transfer protocol: file bytes <-> a list of QR payload strings.
// Payload: QF1|<id>|<seq>|<total>|<z>|<nameBase64Url>|<dataBase64>
//   id    first 16 hex chars of SHA-256 of the original file
//   seq   1-based index, total = number of payloads
//   z     1 = data is deflated, 0 = raw
import { deflateSync, inflateSync } from '../vendor/fflate.mjs';

export const MAX_INPUT_BYTES = 256 * 1024;
export const WARN_INPUT_BYTES = 64 * 1024;
const VERSION = 'QF1';
const DEFAULT_CHUNK_CHARS = 600;

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function nameToB64Url(name) {
  return bytesToBase64(new TextEncoder().encode(name))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToName(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(b));
}

async function sha256Id(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, 16);
}

export function sanitizeFileName(name) {
  let base = String(name ?? '').split(/[\\/]/).pop();
  base = base.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '');
  return base === '' ? 'download.bin' : base;
}

export async function encodeTransfer(bytes, name, opts = {}) {
  const chunkChars = opts.chunkChars ?? DEFAULT_CHUNK_CHARS;
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new Error(`ファイルが大きすぎます(上限 ${MAX_INPUT_BYTES / 1024}KB)`);
  }
  const warnings = [];
  if (bytes.length >= WARN_INPUT_BYTES) {
    warnings.push('ファイルが大きいため、QRコードの枚数が多くなります。');
  }
  const deflated = deflateSync(bytes, { level: 9 });
  const compressed = deflated.length < bytes.length;
  const b64 = bytesToBase64(compressed ? deflated : bytes);
  const id = await sha256Id(bytes);
  const total = Math.max(1, Math.ceil(b64.length / chunkChars));
  const nameField = nameToB64Url(name);
  const payloads = [];
  for (let i = 0; i < total; i++) {
    const data = b64.slice(i * chunkChars, (i + 1) * chunkChars);
    payloads.push([VERSION, id, i + 1, total, compressed ? 1 : 0, nameField, data].join('|'));
  }
  return { id, total, payloads, compressed, warnings };
}

export function parsePayload(text) {
  if (typeof text !== 'string') return null;
  const f = text.split('|');
  if (f.length !== 7 || f[0] !== VERSION) return null;
  const [, id, seqS, totalS, zS, nameField, data] = f;
  if (!/^[0-9a-f]{16}$/.test(id)) return null;
  if (!/^[1-9][0-9]*$/.test(seqS) || !/^[1-9][0-9]*$/.test(totalS)) return null;
  const seq = Number(seqS);
  const total = Number(totalS);
  if (seq > total || (zS !== '0' && zS !== '1')) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || !/^[A-Za-z0-9_-]*$/.test(nameField)) return null;
  let name;
  try {
    name = b64UrlToName(nameField);
  } catch {
    return null;
  }
  return { id, seq, total, compressed: zS === '1', name, data };
}

export class Assembler {
  #meta = null;
  #chunks = new Map();

  add(text) {
    const p = parsePayload(text);
    if (!p) return { status: 'invalid' };
    if (!this.#meta) {
      this.#meta = { id: p.id, total: p.total, compressed: p.compressed, name: p.name };
    } else if (p.id !== this.#meta.id || p.total !== this.#meta.total) {
      return { status: 'foreign' };
    } else if (p.compressed !== this.#meta.compressed) {
      return { status: 'invalid' };
    }
    if (this.#chunks.has(p.seq)) return { status: 'duplicate' };
    this.#chunks.set(p.seq, p.data);
    return { status: 'added', seq: p.seq };
  }

  get progress() {
    const m = this.#meta;
    if (!m) return null;
    const missing = [];
    for (let i = 1; i <= m.total; i++) if (!this.#chunks.has(i)) missing.push(i);
    return { id: m.id, name: m.name, received: this.#chunks.size, total: m.total, missing };
  }

  get complete() {
    return this.#meta !== null && this.#chunks.size === this.#meta.total;
  }

  async finish() {
    if (!this.complete) throw new Error('まだすべてのQRコードを読み取っていません');
    const m = this.#meta;
    let b64 = '';
    for (let i = 1; i <= m.total; i++) b64 += this.#chunks.get(i);
    let bytes;
    try {
      bytes = base64ToBytes(b64);
      if (m.compressed) bytes = inflateSync(bytes);
    } catch {
      throw new Error('データが壊れています。最初からやり直してください');
    }
    if ((await sha256Id(bytes)) !== m.id) {
      throw new Error('ハッシュが一致しません。読み取りミスの可能性があります');
    }
    return { name: sanitizeFileName(m.name), bytes };
  }

  reset() {
    this.#meta = null;
    this.#chunks = new Map();
  }
}
