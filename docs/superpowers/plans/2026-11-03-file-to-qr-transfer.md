# File → QR 転送ツール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任意の小さなファイルをQRコード列(A4相当のPNG、必要なら複数枚)にし、スマホのブラウザ(GitHub Pages)でカメラ読み取りして復元・保存できるようにする。

**Architecture:** プロトコル(圧縮・分割・復元)、QR行列生成、A4ページレイアウト/描画をそれぞれ`src/`の独立ESモジュールとし、Node CLI・ブラウザ送信ページ・ブラウザ受信ページが共有する。ページ描画はCanvas 2D APIで書き、ブラウザは`<canvas>`、Nodeは`@napi-rs/canvas`(プリビルド、ネイティブビルド不要)で同一コードを動かす。ランタイムのビルド工程は無し(素のES modules)。

**Tech Stack:** JavaScript (ES modules, Node 20+), `fflate`(deflate), `qrcode-generator`(QR行列), `jsqr`(読み取り), `@napi-rs/canvas`(Nodeのみ), `esbuild`(依存を`vendor/`に1回バンドルするためだけのdevDependency), `node:test`

**Spec:** `docs/superpowers/specs/2026-11-03-file-to-qr-transfer-design.md`

## Global Constraints

- すべてJavaScript。ランタイムにビルド工程なし。`index.html` / `receive.html` はそのままGitHub Pagesで動くこと
- Pages用ファイルはリポジトリ直下: `index.html`(送信)、`receive.html`(受信)
- 外部CDNに依存しない。ブラウザが読むライブラリは`vendor/`に同梱(コミット対象)
- 結合画像は常にA4相当(縦、210:297)。1ページ内のQRが小さくなりすぎる場合は複数ページに分ける。出力は`out-1.png`, `out-2.png`…(1ページのみなら`out.png`)。各ページに「ページ n/m」、各QRに通しの「n/総数」を表示する
- 1QRで足りるファイルはQR1枚のみ出力する
- 入力ファイルは圧縮後ではなく**元サイズ**で、256KBを超えたらエラー、64KB以上なら警告(枚数が多くなる旨)
- 受信はHTTPS(カメラ)。データは端末外に出さない。復元はハッシュ検証が通ったときだけ保存可能にする
- 暗号化・誤り訂正符号・大容量対応・ネイティブアプリは対象外
- 作業ディレクトリは`C:\Users\fuku\Desktop\ql-converter`。現状gitリポジトリではないため、本計画にコミット手順は含めない

## Review Focus

1. 0バイトのファイル → 往復で0バイトのまま復元される(送信側が拒否もクラッシュもしない)
2. 日本語・絵文字・パス区切りや`<>:"|?*`を含むファイル名 → ヘッダを壊さず、受信側は安全なファイル名で保存する(パス成分は除去)
3. 圧縮で小さくならないデータ(乱数・既存のzip) → 無圧縮フラグで送り、往復で完全一致
4. QRの順不同・重複・欠落・別転送の混入・URLなど無関係なQR → 壊れたファイルを出さず、状態として区別して報告する
5. 上限超えのファイル・1QRの容量境界ちょうどのファイル → 明確なエラー / 正しい枚数

---

### Task 1: プロジェクト初期化とvendor

**Files:**
- Create: `package.json`, `scripts/vendor.mjs`, `tests/vendor.test.mjs`
- Create (generated, committed): `vendor/fflate.mjs`, `vendor/qrcode-generator.mjs`, `vendor/jsqr.mjs`

**Interfaces:**
- Produces: `vendor/fflate.mjs`が`deflateSync`, `inflateSync`をexport / `vendor/qrcode-generator.mjs`がdefault exportで`qrcode(typeNumber, errorCorrectionLevel)`ファクトリ / `vendor/jsqr.mjs`がdefault exportで`jsQR(data, width, height)`
- `package.json`: `"type": "module"`, scripts `test`(`node --test tests/`)と`vendor`(`node scripts/vendor.mjs`)、dependencies `@napi-rs/canvas`、devDependencies `fflate`, `qrcode-generator`, `jsqr`, `esbuild`

- [ ] **Step 1: Write the failing test** `tests/vendor.test.mjs`: 3つのvendorファイルをimportし、`deflateSync`→`inflateSync`の往復、`qrcode(0,'M')`で`addData('hi'); make(); getModuleCount()`が正の整数、`jsQR`が関数であること
- [ ] **Step 2: Run** `npm test` → FAIL(vendorファイルが無い)
- [ ] **Step 3: `scripts/vendor.mjs`を実装**: esbuildのJS APIで各ライブラリ(`node_modules`内)を`format: 'esm'`, `bundle: true`で`vendor/*.mjs`に出力(CJS/UMDのdefault exportがESMのdefaultになること)。`npm install`後に`npm run vendor`
- [ ] **Step 4: Run** `npm install && npm run vendor && npm test` → PASS

### Task 2: プロトコル(圧縮・分割・復元)

**Files:**
- Create: `src/protocol.mjs`
- Test: `tests/protocol.test.mjs`

**Interfaces:**
- Consumes: `vendor/fflate.mjs`
- Produces:
  - `MAX_INPUT_BYTES = 256*1024`, `WARN_INPUT_BYTES = 64*1024`
  - `encodeTransfer(bytes: Uint8Array, name: string, opts?: {chunkChars?: number}): Promise<{id: string, total: number, payloads: string[], compressed: boolean, warnings: string[]}>` — `chunkChars`既定600。`MAX_INPUT_BYTES`超過は`Error`
  - `parsePayload(text: string): {id, seq, total, compressed, name, data} | null` — 形式違反は`null`
  - `class Assembler`: `add(text): {status: 'added'|'duplicate'|'foreign'|'invalid'}`, `get progress(): {id, name, received, total, missing: number[]} | null`, `get complete(): boolean`, `finish(): Promise<{name: string, bytes: Uint8Array}>`(未完了・ハッシュ不一致は`Error`), `reset(): void`
  - `sanitizeFileName(name: string): string` — パス成分除去、`<>:"/\|?*`と制御文字を`_`に、空なら`download.bin`
- ペイロード書式(提案・実装者が変えてよいが下のテストを満たすこと): `QF1|<id>|<seq>|<total>|<z>|<nameBase64Url>|<dataBase64>`、`id`=元ファイルSHA-256の先頭16桁hex、`seq`は1始まり、`z`は1=deflate/0=無圧縮(圧縮して小さくならなければ0)。データは(圧縮後)全体を1つのBase64にしてから`chunkChars`文字ずつ切る

- [ ] **Step 1: Write the failing tests** (`node:test`、`assert/strict`):
  - `roundtrip: binary payload`: 1000バイトの乱数を`encodeTransfer`→全payloadsを`Assembler.add`→`finish()`で`bytes`が一致し`name`が一致
  - `roundtrip: shuffled order with duplicates`: payloads配列をシャッフル+先頭を重複追加 → 重複は`status==='duplicate'`、`finish()`成功
  - `roundtrip: empty file`: 0バイト(Review Focus 1)。`total>=1`で復元結果が空
  - `roundtrip: unicode filename`: 名前`"日本語 🎉/a:b.txt"` → `finish().name === sanitizeFileName(...)`で`/`, `:`を含まない。ペイロード文字列に改行や`|`の誤分割が起きない(`parsePayload(p).name`が元の名前)
  - `incompressible data uses z=0`: 乱数2000バイト → `compressed === false`、往復一致。既存のzipバイト列(`zipSync`相当、fflate)でも一致
  - `compressible data is smaller`: 繰り返し文字列20KBの`total`が無圧縮の場合より小さい
  - `missing chunk`: 1枚欠けると`complete===false`、`progress.missing`に欠けたseq、`finish()`は`Error`
  - `foreign transfer`: 別ファイルのpayloadを`add`すると`status==='foreign'`で進捗は変わらない
  - `garbage input`: `"https://example.com"`や`"QF1|broken"`は`status==='invalid'`でクラッシュしない(Review Focus 4)
  - `tampered data fails hash`: 1枚のデータ部のBase64を改変(長さ維持) → `finish()`が`Error`(壊れたファイルを返さない)
  - `size limit`: `MAX_INPUT_BYTES+1`バイトで`encodeTransfer`が`Error`、`WARN_INPUT_BYTES`以上では`warnings`が1件以上
  - `capacity boundary`: `chunkChars`ちょうどのBase64長となる入力で`total`が正しい(Review Focus 5)
- [ ] **Step 2: Run** `node --test tests/protocol.test.mjs` → FAIL
- [ ] **Step 3: `src/protocol.mjs`を実装**。ハッシュは`crypto.subtle.digest`(Node/ブラウザ共通)。Base64はブラウザ・Node両方で動くよう`btoa`/`atob`を大きいデータ向けに分割して使う。`Assembler`は最初の有効payloadで`id`/`total`を確定し、以降`id`または`total`が違えば`foreign`、同じ`seq`は`duplicate`
- [ ] **Step 4: Run** `node --test tests/protocol.test.mjs` → PASS

### Task 3: QR行列とA4ページのレイアウト・描画

**Files:**
- Create: `src/qr.mjs`, `src/layout.mjs`
- Test: `tests/layout.test.mjs`

**Interfaces:**
- Consumes: `vendor/qrcode-generator.mjs`
- Produces:
  - `buildMatrices(payloads: string[], ec?: 'L'|'M'|'Q'|'H' = 'M'): {moduleCount: number, matrices: boolean[][][]}` — 全payloadで同一バージョンの行列(最長payloadが収まる最小バージョン)。容量超過は`Error`
  - `A4 = {width: 2480, height: 3508}`
  - `planLayout(moduleCount: number, qrCount: number, opts?: {minModulePx?: number /*既定6*/, maxPerPage?: number /*既定12*/}): {cols, rows, perPage, pageCount, modulePx}` — `maxPerPage`以下の`cols×rows`のうち、`modulePx >= minModulePx`を満たす最大の組み合わせ(1QR/ページでも満たせなければ1QR/ページ)。余白・静寂領域・ラベル領域を含めて計算。`pageCount = ceil(qrCount / perPage)`
  - `drawPage(ctx: CanvasRenderingContext2D, plan, pageIndex: number /*0始まり*/, matrices: boolean[][][], meta: {name: string, total: number}): void` — 白背景に、上部にタイトル(ファイル名・「ページ n/m」)、各セルにQR(`modulePx`整数倍で描画しにじませない)と通し「n/総数」を描く。ページ内の最後の行が埋まらなくてもよい

- [ ] **Step 1: Write the failing tests** `tests/layout.test.mjs`:
  - `buildMatrices`: 長さの異なる2つのpayloadsで`matrices`の行数・列数がすべて`moduleCount`に等しい
  - `buildMatrices` throws on oversize(例: 5000文字のpayload)
  - `planLayout(45, 3)`の`perPage >= 3`かつ`pageCount === 1`(小さいQRは1ページに収まる)
  - `planLayout(100, 30)`は`modulePx >= 6`、`perPage <= 12`、`pageCount === ceil(30/perPage)`
  - `planLayout(177, 5, {minModulePx: 6})`: v40相当の巨大QRでも`perPage >= 1`、`pageCount === ceil(5/perPage)`で例外なし
  - `drawPage`: 簡易モックctx(`fillRect`/`fillText`/`fillStyle`等を記録するだけ)で、1ページ分のQRセル数ぶん黒の`fillRect`が呼ばれ、例外が出ない(実際の画像一致はTask 4のe2eで確認)
- [ ] **Step 2: Run** `node --test tests/layout.test.mjs` → FAIL
- [ ] **Step 3: `src/qr.mjs`と`src/layout.mjs`を実装**。バージョンはqrcode-generatorに`typeNumber`を渡す(最小バージョンは0指定で一度ずつ試して最大を採用)。ブラウザ・Nodeどちらでも依存しない純粋関数にする
- [ ] **Step 4: Run** `node --test tests/layout.test.mjs` → PASS

### Task 4: Node CLI(エンドツーエンド)

**Files:**
- Create: `cli/make-qr.mjs`
- Test: `tests/cli.test.mjs`

**Interfaces:**
- Consumes: `encodeTransfer`, `buildMatrices`, `planLayout`, `drawPage`, `A4`
- Produces:
  - `makeQrImages(inputPath: string, opts?: {out?: string, ec?: string, chunkChars?: number, maxPerPage?: number}): Promise<{files: string[], total: number, warnings: string[]}>` — PNG出力。ページが1枚なら`<out>`、複数なら`<out基底名>-1.png`…。`out`既定は`<入力ファイル名>.qr.png`(入力と同じディレクトリ)
  - コマンド: `node cli/make-qr.mjs <file> [-o out.png] [--ec M] [--chunk 600] [--per-page 12]`、成功時に出力ファイルと総QR数、警告を標準出力に出す

- [ ] **Step 1: Write the failing test** `tests/cli.test.mjs`:
  - `end-to-end`: 一時ディレクトリに約5KBの乱数ファイルを作り、`makeQrImages(..., {maxPerPage: 1})`でPNGを生成 → 各PNGを`@napi-rs/canvas`の`loadImage`で読み、`getImageData`→`jsQR`でデコードしたテキストを`Assembler.add`に流し、`finish()`の`bytes`が元ファイルと一致
  - `single page naming`: 100バイトのファイルでは`files`が1件でファイル名が`out`指定どおり、5KBで`maxPerPage:3`なら`-1.png`,`-2.png`…の連番になる
  - `rejects oversized`: 257KBのファイルで`Error`(ファイルは作られない)
- [ ] **Step 2: Run** `node --test tests/cli.test.mjs` → FAIL
- [ ] **Step 3: `cli/make-qr.mjs`を実装**。`@napi-rs/canvas`の`createCanvas(A4.width, A4.height)`→`drawPage`→`toBuffer('image/png')`。引数解析は`node:util`の`parseArgs`。`import.meta.url`がエントリのときだけCLIとして動く
- [ ] **Step 4: Run** `npm test` → 全PASS。手動確認: `node cli/make-qr.mjs <適当な20KBファイル> -o tmp.png` でPNGが生成され、画像を開いて内容が見えること

### Task 5: ブラウザ送信ページ

**Files:**
- Create: `index.html`, `web/send.mjs`, `web/style.css`

**Interfaces:**
- Consumes: `encodeTransfer`, `buildMatrices`, `planLayout`, `drawPage`, `A4`(すべて`src/`)
- 動作: ファイル選択/ドラッグ&ドロップ → オプション(誤り訂正レベル、1QRあたり文字数、1ページあたり最大QR数)を既定値付きで表示 → 「生成」でページごとの`<canvas>`(幅は画面に合わせて縮小表示、内部はA4解像度)を並べて表示。各ページに「PNG保存」、全ページの「すべて保存」。警告(64KB以上等)・エラー(256KB超)を画面に表示。モバイルでも崩れない最小限のCSS

- [ ] **Step 1: 実装**。`drawPage`にそのまま`canvas.getContext('2d')`を渡す。保存は`canvas.toBlob`+`<a download>`で、ファイル名はCLIと同じ命名規則
- [ ] **Step 2: ローカル確認**: `npx serve .`(または`python -m http.server`)で`index.html`を開き、(a) 小ファイルでQR1枚、(b) 約30KBで複数ページ、(c) 0バイトファイル、(d) 257KBでエラー表示、をそれぞれ確認。ブラウザのコンソールにエラーが出ないこと
- [ ] **Step 3: 自動テストの追加は不要**(コアはTask 2〜4で検証済み)。代わりにStep 2の結果を報告に含める

### Task 6: ブラウザ受信ページ

**Files:**
- Create: `receive.html`, `web/receive.mjs`

**Interfaces:**
- Consumes: `Assembler`, `sanitizeFileName`(`src/protocol.mjs`), `vendor/jsqr.mjs`
- 動作: 「カメラ開始」(`getUserMedia({video: {facingMode: 'environment'}})`、`<video playsinline muted>`) → 約10fpsでフレームを`<canvas>`に描いて`jsQR`でデコード → テキストを`Assembler.add`。進捗(受信数/総数)と「n番が未取得」の一覧、読み取り直後に追加/重複/別転送/無効を短く表示。全部そろったら`finish()`し、成功なら「ダウンロード」ボタン(`Blob`+`<a download>`、ファイル名はサニタイズ済み)、ハッシュ不一致なら赤字のエラーでダウンロード不可。「やり直し」で`reset()`。別転送のQRを検出したら「別のファイルのQRです。切り替える場合は『やり直し』」を表示。カメラ拒否時は理由と対処(ブラウザ設定でカメラ許可)を表示。GitHub Pages(HTTPS)でのみ動く旨をページに明記

- [ ] **Step 1: 実装**
- [ ] **Step 2: ローカル確認**: `localhost`で配信(localhostはカメラ許可対象)し、PCのWebカメラにタスク5で生成した画面表示のQRをかざして、(a) 小ファイルが復元される、(b) 順番を変えて読んでも復元される、(c) 無関係なQR(URL)を読んでも無視される、(d) ダウンロードしたファイルが元と一致(`fc /b` または`cmp`)、を確認
- [ ] **Step 3: 自動テストは不要**(`Assembler`はTask 2で検証済み)

### Task 7: README・公開手順・実機確認

**Files:**
- Create: `README.md`

- [ ] **Step 1: READMEを書く**: 使い方(ブラウザ版、CLI版)、受信手順、制限(256KB、枚数の目安: 50KBでおよそ何ページになるかを実測値で記載)、GitHub Pagesの有効化手順(リポジトリのSettings → Pages → Branch: main / root)、`npm run vendor`が必要になる場面(依存更新時のみ)
- [ ] **Step 2: 実機確認チェックリストを実施**(スマホ、Pages公開後): 小ファイル/約30KB/約50KB(複数ページ)の転送、画面表示と印刷の両方、読み取りの安定性。最小QRサイズ`minModulePx`・`chunkChars`・`maxPerPage`の既定値が実機で読みにくければ調整し、その値と理由をREADMEに残す
- [ ] **Step 3: Run** `npm test` → 全PASS
