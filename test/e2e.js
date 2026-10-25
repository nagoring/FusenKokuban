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

  // 移動
  let box = await note.boundingBox();
  const hb = await page.locator('.note-header').boundingBox();
  await page.mouse.move(hb.x + 20, hb.y + 10);
  await page.mouse.down();
  await page.mouse.move(hb.x + 120, hb.y + 60, { steps: 5 });
  await page.mouse.up();
  let box2 = await note.boundingBox();
  assert.strictEqual(Math.round(box2.x - box.x), 100);
  assert.strictEqual(Math.round(box2.y - box.y), 50);

  // 右下に広げる
  const se = await page.locator('.resizer.se').boundingBox();
  await page.mouse.move(se.x + 6, se.y + 6);
  await page.mouse.down();
  await page.mouse.move(se.x + 56, se.y + 36, { steps: 5 });
  await page.mouse.up();
  let box3 = await note.boundingBox();
  assert.strictEqual(Math.round(box3.width - box2.width), 50);
  assert.strictEqual(Math.round(box3.height - box2.height), 30);

  // 左上に広げる（位置も動く）
  const nw = await page.locator('.resizer.nw').boundingBox();
  await page.mouse.move(nw.x + 6, nw.y + 6);
  await page.mouse.down();
  await page.mouse.move(nw.x - 34, nw.y - 14, { steps: 5 });
  await page.mouse.up();
  let box4 = await note.boundingBox();
  assert.strictEqual(Math.round(box4.width - box3.width), 40);
  assert.strictEqual(Math.round(box4.height - box3.height), 20);
  assert.strictEqual(Math.round(box3.x - box4.x), 40);

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
