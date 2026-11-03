// QR matrix generation. All matrices share one version (size) so a page of
// QRs looks uniform and the layout can be planned from a single module count.
import qrcode from '../vendor/qrcode-generator.mjs';

function make(text, typeNumber, ec) {
  const qr = qrcode(typeNumber, ec);
  qr.addData(text, 'Byte');
  qr.make();
  return qr;
}

export function buildMatrices(payloads, ec = 'M') {
  let typeNumber = 1;
  for (const p of payloads) {
    const n = make(p, 0, ec).getModuleCount();
    typeNumber = Math.max(typeNumber, (n - 17) / 4);
  }
  const matrices = payloads.map((p) => {
    const qr = make(p, typeNumber, ec);
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
  });
  return { moduleCount: 17 + typeNumber * 4, matrices };
}
