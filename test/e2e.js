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
  assert.strictEqual(await page.inputValue('.note-text'), 'こんにちは hello');

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
  assert.strictEqual(await page.inputValue('.note-text'), 'こんにちは hello');
  assert.strictEqual(await page.$eval('#board', (el) => getComputedStyle(el).backgroundColor), 'rgb(18, 52, 86)');
  await app.close();

  console.log('OK: all e2e checks passed (screenshot: ' + path.join(userData, 'shot.png') + ')');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
