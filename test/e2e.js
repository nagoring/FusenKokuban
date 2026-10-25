// Electron アプリを起動して主要操作を確認する簡易E2Eテスト（Playwright 使用）
const { _electron: electron } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fusen-'));
  const launch = () => electron.launch({
    executablePath: require('electron'),
    args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'],
  });

  let app = await launch();
  let page = await app.firstWindow();
  await page.waitForSelector('#board');

  // 背景は初期状態で緑
  const bg = await page.$eval('#board', (el) => getComputedStyle(el).backgroundColor);
  assert.strictEqual(bg, 'rgb(47, 93, 58)');

  // ダブルクリックで付箋作成
  await page.mouse.dblclick(300, 300);
  const note = page.locator('.note');
  assert.strictEqual(await note.count(), 1);

  // 文字入力
  await page.keyboard.type('こんにちは hello');
  assert.strictEqual(await page.$eval('.note-text', (el) => el.innerText), 'こんにちは hello');

  // タイトルバーは無い
  assert.strictEqual(await page.locator('.note-header').count(), 0);

  const drag = async (sel, dx, dy, fx = 0.5) => {
    const b = await page.locator(sel).boundingBox();
    const x = b.x + b.width * fx;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 5 });
    await page.mouse.up();
  };
  const rect = async () => {
    const b = await note.boundingBox();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };

  // グリップで移動
  let r0 = await rect();
  await drag('.note-grip', 100, 50);
  let r1 = await rect();
  assert.deepStrictEqual(r1, { x: r0.x + 100, y: r0.y + 50, w: r0.w, h: r0.h });

  // 枠線（下辺）で移動
  await drag('.note-edge.bottom', -30, 20, 0.25);
  r0 = r1;
  r1 = await rect();
  assert.deepStrictEqual(r1, { x: r0.x - 30, y: r0.y + 20, w: r0.w, h: r0.h });

  // 8か所のハンドルで拡大・縮小
  const cases = {
    e:  [30, 0,   { dw: 30, dh: 0, dx: 0, dy: 0 }],
    w:  [-30, 0,  { dw: 30, dh: 0, dx: -30, dy: 0 }],
    s:  [0, 20,   { dw: 0, dh: 20, dx: 0, dy: 0 }],
    n:  [0, -20,  { dw: 0, dh: 20, dx: 0, dy: -20 }],
    se: [-40, -30, { dw: -40, dh: -30, dx: 0, dy: 0 }],
    nw: [20, 10,  { dw: -20, dh: -10, dx: 20, dy: 10 }],
    ne: [25, -15, { dw: 25, dh: 15, dx: 0, dy: -15 }],
    sw: [-25, 15, { dw: 25, dh: 15, dx: -25, dy: 0 }],
  };
  for (const [dir, [mx, my, exp]] of Object.entries(cases)) {
    const before = await rect();
    await drag('.resizer.' + dir, mx, my);
    const after = await rect();
    assert.deepStrictEqual(
      { dw: after.w - before.w, dh: after.h - before.h, dx: after.x - before.x, dy: after.y - before.y },
      exp, 'resize ' + dir);
  }

  // 付箋の色・文字色・文字サイズ変更
  assert.strictEqual(await page.locator('.note-style').isVisible(), true);
  await page.click('.note-style .swatch[data-color="#f8bbd0"]');
  assert.strictEqual(await note.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(248, 187, 208)');
  await page.$eval('.note-text-color', (el) => {
    el.value = '#c62828';
    el.dispatchEvent(new Event('input'));
  });
  assert.strictEqual(await page.$eval('.note-text', (el) => getComputedStyle(el).color), 'rgb(198, 40, 40)');
  await page.selectOption('.note-font-size', '24');
  assert.strictEqual(await page.$eval('.note-text', (el) => getComputedStyle(el).fontSize), '24px');
  assert.strictEqual(await note.count(), 1, 'スタイル変更で付箋が増えない');

  // 一部だけ選択して文字色・大きさを変える（#11）
  await page.$eval('.note-text', (el) => {
    const t = el.firstChild;
    const r = document.createRange();
    r.setStart(t, t.data.indexOf('hello'));
    r.setEnd(t, t.data.length);
    el.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.waitForTimeout(50); // selectionchange は非同期
  await page.$eval('.note-text-color', (el) => {
    el.value = '#1565c0';
    el.dispatchEvent(new Event('input'));
  });
  await page.$eval('.note-text-color', (el) => {
    el.value = '#2e7d32';
    el.dispatchEvent(new Event('input'));
  });
  await page.selectOption('.note-font-size', '48');
  const partStyle = () => page.$eval('.note-text', (el) => {
    const span = el.querySelector('span');
    return {
      spans: el.querySelectorAll('span').length,
      text: span.textContent,
      color: getComputedStyle(span).color,
      size: getComputedStyle(span).fontSize,
      baseColor: getComputedStyle(el).color,
      baseSize: getComputedStyle(el).fontSize,
      all: el.innerText,
    };
  });
  assert.deepStrictEqual(await partStyle(), {
    spans: 1, text: 'hello', color: 'rgb(46, 125, 50)', size: '48px',
    baseColor: 'rgb(198, 40, 40)', baseSize: '24px', all: 'こんにちは hello',
  }, '選択した部分だけ変わり、付箋全体の設定はそのまま');
  assert.strictEqual(await page.$eval('.note-font-size', (el) => el.value), '24', 'バーの表示は付箋全体の大きさに戻る');

  // 選択していなければ従来どおり付箋全体に適用される
  await page.$eval('.note-text', (el) => {
    const sel = window.getSelection();
    sel.removeAllRanges();
    const r = document.createRange();
    r.setStart(el.firstChild, 0);
    sel.addRange(r);
  });
  await page.waitForTimeout(50);
  await page.selectOption('.note-font-size', '18');
  assert.strictEqual(await page.$eval('.note-text', (el) => getComputedStyle(el).fontSize), '18px');
  assert.strictEqual(await page.$eval('.note-text span', (el) => getComputedStyle(el).fontSize), '48px');
  await page.selectOption('.note-font-size', '24');

  // 選択中のスクショ
  await page.screenshot({ path: path.join(userData, 'selected.png') });

  // 背景クリックで選択解除するとハンドルが消える
  await page.mouse.click(1000, 700);
  assert.strictEqual(await page.locator('.resizer.se').isVisible(), false);

  // 背景色変更
  await page.$eval('#bg-color', (el) => {
    el.value = '#123456';
    el.dispatchEvent(new Event('input'));
  });
  assert.strictEqual(await page.$eval('#board', (el) => getComputedStyle(el).backgroundColor), 'rgb(18, 52, 86)');

  await page.screenshot({ path: path.join(userData, 'shot.png') });
  await app.close();

  // 再起動後も内容が復元される
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('.note');
  assert.strictEqual(await page.$eval('.note-text', (el) => el.innerText), 'こんにちは hello');
  assert.strictEqual(await page.$eval('#board', (el) => getComputedStyle(el).backgroundColor), 'rgb(18, 52, 86)');
  assert.strictEqual(await page.$eval('.note', (el) => getComputedStyle(el).backgroundColor), 'rgb(248, 187, 208)');
  assert.strictEqual(await page.$eval('.note-text', (el) => getComputedStyle(el).color), 'rgb(198, 40, 40)');
  assert.strictEqual(await page.$eval('.note-text', (el) => getComputedStyle(el).fontSize), '24px');
  assert.strictEqual(await page.$eval('.note-text span', (el) => getComputedStyle(el).color), 'rgb(46, 125, 50)');
  assert.strictEqual(await page.$eval('.note-text span', (el) => getComputedStyle(el).fontSize), '48px');

  // ---- ファイルへの保存・読み込み ----
  const savePath = path.join(userData, 'board.fusen');
  const stubDialogs = (filePath) => app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  page.on('dialog', (d) => d.accept());
  await stubDialogs(savePath);

  // ボタンで保存
  await page.click('#board-save');
  for (let i = 0; i < 20 && !fs.existsSync(savePath); i++) await page.waitForTimeout(100);
  const saved = JSON.parse(fs.readFileSync(savePath, 'utf8'));
  assert.strictEqual(saved.format, 'fusenkokuban');
  assert.strictEqual(saved.background, '#123456');
  assert.strictEqual(saved.notes.length, 1);
  assert.strictEqual(saved.notes[0].text, 'こんにちは hello');

  // 内容を変えてから読み込むと保存時の状態に戻る
  await page.mouse.dblclick(900, 500);
  await page.keyboard.type('あとで消える');
  await page.$eval('#bg-color', (el) => {
    el.value = '#000000';
    el.dispatchEvent(new Event('input'));
  });
  assert.strictEqual(await page.locator('.note').count(), 2);
  await page.click('#board-load');
  await page.waitForFunction(() => document.querySelectorAll('.note').length === 1);
  assert.strictEqual(await page.$eval('.note-text', (el) => el.innerText), 'こんにちは hello');
  assert.strictEqual(await page.$eval('#board', (el) => getComputedStyle(el).backgroundColor), 'rgb(18, 52, 86)');
  assert.strictEqual(await page.$eval('.note', (el) => getComputedStyle(el).backgroundColor), 'rgb(248, 187, 208)');

  // ショートカットでも保存できる
  const savePath2 = path.join(userData, 'board2.fusen');
  await stubDialogs(savePath2);
  await page.mouse.click(1000, 700);
  await page.keyboard.press('Control+s');
  for (let i = 0; i < 20 && !fs.existsSync(savePath2); i++) await page.waitForTimeout(100);
  assert.strictEqual(JSON.parse(fs.readFileSync(savePath2, 'utf8')).notes.length, 1);

  // 付箋黒板のファイルでなければ読み込まない
  const badPath = path.join(userData, 'bad.json');
  fs.writeFileSync(badPath, '{"hello": 1}');
  await stubDialogs(badPath);
  let alerted = null;
  page.once('dialog', (d) => { alerted = d.message(); });
  await page.click('#board-load');
  for (let i = 0; i < 20 && !alerted; i++) await page.waitForTimeout(100);
  assert.ok(alerted && alerted.includes('付箋黒板のファイルではありません'));
  assert.strictEqual(await page.locator('.note').count(), 1);

  await page.screenshot({ path: path.join(userData, 'toolbar.png') });

  // ---- 画像の付箋 ----
  // 200x100 の赤い PNG をドロップで貼る
  const pngBase64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e53935';
    ctx.fillRect(0, 0, 200, 100);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'red.png', { type: 'image/png' }));
    const board = document.getElementById('board');
    board.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 700, clientY: 200 }));
    board.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 700, clientY: 200 }));
  }, pngBase64);
  const img = page.locator('.note.image');
  await img.waitFor();
  const ib = await img.boundingBox();
  assert.deepStrictEqual(
    { x: Math.round(ib.x), y: Math.round(ib.y), w: Math.round(ib.width), h: Math.round(ib.height) },
    { x: 600, y: 150, w: 200, h: 100 }, 'ドロップ位置を中心に原寸で貼られる');
  assert.strictEqual(await page.locator('.note.image .note-text').count(), 0);
  assert.strictEqual(await page.locator('.note.image .note-style').count(), 0);

  const imgRect = async () => {
    const b = await img.boundingBox();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  // 四隅は縦横比を保って拡大
  let before = await imgRect();
  await drag('.note.image .resizer.se', 100, 10);
  let after = await imgRect();
  assert.deepStrictEqual(after, { x: before.x, y: before.y, w: 300, h: 150 }, 'se は縦横比維持');
  before = after;
  await drag('.note.image .resizer.nw', 100, 0);
  after = await imgRect();
  assert.deepStrictEqual(after, { x: before.x + 100, y: before.y + 50, w: 200, h: 100 }, 'nw は縦横比維持');
  // 辺は片方向だけ変わる
  before = after;
  await drag('.note.image .resizer.e', 40, 0);
  after = await imgRect();
  assert.deepStrictEqual(after, { ...before, w: before.w + 40 }, 'e は横だけ');
  // 画像そのものをドラッグして移動
  before = after;
  await drag('.note.image .note-image', -50, 30);
  after = await imgRect();
  assert.deepStrictEqual(after, { ...before, x: before.x - 50, y: before.y + 30 }, '画像ドラッグで移動');

  // クリップボードの画像を Ctrl+V で貼る
  await app.evaluate(({ clipboard, nativeImage }, b64) => {
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(b64, 'base64')));
  }, pngBase64);
  await page.mouse.click(300, 650);
  await page.keyboard.press('Control+v');
  await page.waitForFunction(() => document.querySelectorAll('.note.image').length === 2);
  const pasted = await page.locator('.note.image').nth(1).boundingBox();
  assert.deepStrictEqual(
    { x: Math.round(pasted.x), y: Math.round(pasted.y), w: Math.round(pasted.width), h: Math.round(pasted.height) },
    { x: 200, y: 600, w: 200, h: 100 }, 'マウス位置を中心に貼られる');

  // 画像はファイル保存にも含まれる
  const imgSavePath = path.join(userData, 'image.fusen');
  await stubDialogs(imgSavePath);
  await page.click('#board-save');
  for (let i = 0; i < 20 && !fs.existsSync(imgSavePath); i++) await page.waitForTimeout(100);
  const imgSaved = JSON.parse(fs.readFileSync(imgSavePath, 'utf8'));
  assert.strictEqual(imgSaved.notes.filter((n) => n.type === 'image' && n.image.startsWith('data:image/png')).length, 2);

  await page.screenshot({ path: path.join(userData, 'image.png') });
  await app.close();

  // 再起動後も画像の付箋が復元される
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('.note.image');
  assert.strictEqual(await page.locator('.note.image').count(), 2);
  assert.strictEqual(await page.locator('.note').count(), 3);
  assert.strictEqual(await page.$eval('.note.image img', (el) => el.naturalWidth), 200);

  // 旧形式（text のみ）や不正な HTML を含むファイルも安全に読み込める
  const legacyPath = path.join(userData, 'legacy.fusen');
  fs.writeFileSync(legacyPath, JSON.stringify({
    format: 'fusenkokuban', version: 1, background: '#2f5d3a',
    notes: [
      { id: 'a', x: 50, y: 100, w: 200, h: 120, z: 1, text: '1行目\n<b>2行目</b>' },
      { id: 'b', x: 300, y: 100, w: 200, h: 120, z: 2, text: 'x',
        html: '<img src="x" onerror="window.hacked=1"><span style="color: red; position: fixed" onclick="x()">赤</span><script>window.hacked=1</script>' },
    ],
  }));
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, legacyPath);
  page.on('dialog', (d) => d.accept());
  await page.click('#board-load');
  await page.waitForFunction(() => document.querySelectorAll('.note').length === 2);
  const texts = await page.$$eval('.note-text', (els) => els.map((el) => ({ text: el.innerText, html: el.innerHTML })));
  assert.strictEqual(texts[0].text, '1行目\n<b>2行目</b>', '旧形式の文字はそのまま表示');
  assert.strictEqual(texts[1].html, '<span style="color: red;">赤</span>', '不要なタグ・属性・書式は除去');
  assert.strictEqual(await page.evaluate(() => window.hacked), undefined);
  await app.close();

  console.log('OK: all e2e checks passed (screenshot: ' + path.join(userData, 'shot.png') + ')');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
