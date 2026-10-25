'use strict';

const DEFAULT_BG = '#2f5d3a';
const STORAGE_KEY = 'fusenkokuban';
const MIN_W = 60;
const MIN_H = 40;
const DEFAULT_NOTE_COLOR = '#fff59d';
const DEFAULT_TEXT_COLOR = '#222222';
const DEFAULT_FONT_SIZE = 15;
const NOTE_COLORS = ['#fff59d', '#ffcc80', '#f8bbd0', '#b3e5fc', '#c5e1a5', '#ffffff'];
const FONT_SIZES = [12, 15, 18, 24, 32, 48];
const STYLE_BAR_SPACE = 40; // 付箋の上にスタイルバーを出せる最小の余白

const board = document.getElementById('board');
const bgInput = document.getElementById('bg-color');
const bgReset = document.getElementById('bg-reset');

const FILE_FORMAT = 'fusenkokuban';
const FILE_VERSION = 1;

let state = load();
let topZ = 0;

function parseState(json) {
  try {
    const data = JSON.parse(json);
    if (data && Array.isArray(data.notes)) return data;
  } catch (e) { /* 壊れたデータは無視 */ }
  return null;
}

function load() {
  // 旧版は localStorage に保存していたので、ファイルが無ければそちらから引き継ぐ
  return parseState(window.fusen.readState())
    || parseState(localStorage.getItem(STORAGE_KEY))
    || { background: DEFAULT_BG, notes: [] };
}

// 文字入力のたびに書き込まないよう、少し待ってからまとめて保存する
const SAVE_DELAY = 300;
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DELAY);
}

function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  window.fusen.writeState(JSON.stringify(state)).catch(() => { /* 保存できなくても動作は継続 */ });
}

window.addEventListener('beforeunload', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    window.fusen.writeStateSync(JSON.stringify(state));
  }
});

// ---- 背景色 ----
function setBackground(color) {
  state.background = color;
  board.style.background = color;
  bgInput.value = color;
  save();
}

bgInput.addEventListener('input', () => setBackground(bgInput.value));
bgReset.addEventListener('click', () => setBackground(DEFAULT_BG));

// ---- 付箋 ----
function bringToFront(note, el) {
  note.z = ++topZ;
  el.style.zIndex = note.z;
}

function applyRect(note, el) {
  el.style.left = note.x + 'px';
  el.style.top = note.y + 'px';
  el.style.width = note.w + 'px';
  el.style.height = note.h + 'px';
  // 画面上端に近いときはスタイルバーを付箋の下側に出す
  el.classList.toggle('bar-below', note.y < STYLE_BAR_SPACE);
}

function applyStyle(note, el) {
  if (note.type === 'image') return;
  const text = el.querySelector('.note-text');
  el.style.background = note.color || DEFAULT_NOTE_COLOR;
  text.style.color = note.textColor || DEFAULT_TEXT_COLOR;
  text.style.fontSize = (note.fontSize || DEFAULT_FONT_SIZE) + 'px';
}

// ---- 本文（リッチテキスト） ----
// 本文は HTML で持つ。読み込んだファイル由来の HTML も通すため、使うタグと書式だけ残す
const ALLOWED_TAGS = new Set(['DIV', 'P', 'BR', 'SPAN', 'B', 'I', 'U', 'FONT']);
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH']);

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, '<br>');
}

function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const clean = (parent) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) continue;
      if (node.nodeType !== Node.ELEMENT_NODE || !ALLOWED_TAGS.has(node.tagName)) {
        // 不明な要素は中の文字だけ残す
        if (node.nodeType === Node.ELEMENT_NODE && !DROPPED_TAGS.has(node.tagName.toUpperCase())) {
          clean(node);
          node.replaceWith(...node.childNodes);
        } else {
          node.remove();
        }
        continue;
      }
      const el = node.tagName === 'FONT' ? fontToSpan(node) : node;
      const color = el.style.color;
      const fontSize = el.style.fontSize;
      for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
      if (color) el.style.color = color;
      if (fontSize) el.style.fontSize = fontSize;
      clean(el);
    }
  };
  clean(tpl.content);
  return tpl.innerHTML;
}

// 古い形式の <font color> は <span style> に置き換える
function fontToSpan(font) {
  const span = document.createElement('span');
  if (font.getAttribute('color')) span.style.color = font.getAttribute('color');
  font.replaceWith(span);
  span.append(...font.childNodes);
  return span;
}

function noteHtml(note) {
  return note.html != null ? sanitizeHtml(note.html) : escapeHtml(note.text || '');
}

// 付箋ごとに、本文で最後に選択していた範囲を覚えておく（色の選択などでフォーカスが外れても使えるように）
const savedRanges = new WeakMap();

document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.anchorNode;
  const editor = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('.note-text');
  if (!editor) return;
  savedRanges.set(editor, sel.isCollapsed ? null : sel.getRangeAt(0).cloneRange());
});

// 本文の選択範囲があれば、その部分に書式（color / fontSize）を付けて true を返す
function formatSelection(editor, prop, value) {
  const range = savedRanges.get(editor);
  if (!range || range.collapsed || !editor.contains(range.commonAncestorContainer)) return false;
  // 直前に書式を付けた部分をそのまま選んでいるなら、その要素の書式を変えるだけにする
  const node = range.startContainer;
  if (node === range.endContainer && node.tagName === 'SPAN' && node !== editor
      && range.startOffset === 0 && range.endOffset === node.childNodes.length) {
    node.style[prop] = value;
    editor.dispatchEvent(new Event('input'));
    return true;
  }
  const frag = range.extractContents();
  // 範囲内に元からある同じ書式は外して、新しい指定に揃える
  frag.querySelectorAll('[style]').forEach((c) => { c.style[prop] = ''; });
  const span = document.createElement('span');
  span.style[prop] = value;
  span.appendChild(frag);
  range.insertNode(span);
  // 続けて別の書式も付けられるよう、書式を付けた部分を選択したままにする
  const r = document.createRange();
  r.selectNodeContents(span);
  editor.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  savedRanges.set(editor, r.cloneRange());
  editor.dispatchEvent(new Event('input'));
  return true;
}

// 選択中の付箋に表示する、背景色・文字色・文字サイズの変更バー
// 本文の一部を選択しているときは、文字色・文字サイズはその部分だけに適用する
function createStyleBar(note, el) {
  const bar = document.createElement('div');
  bar.className = 'note-style';
  const editor = el.querySelector('.note-text');

  const update = (patch) => {
    Object.assign(note, patch);
    applyStyle(note, el);
    sync();
    save();
  };

  const swatches = NOTE_COLORS.map((color) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.title = '付箋の色';
    b.dataset.color = color;
    b.style.background = color;
    b.addEventListener('click', () => update({ color }));
    return b;
  });

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'note-color';
  colorInput.title = '付箋の色（自由に選ぶ）';
  colorInput.addEventListener('input', () => update({ color: colorInput.value }));

  const textColorLabel = document.createElement('label');
  textColorLabel.className = 'text-color';
  textColorLabel.title = '文字の色';
  textColorLabel.textContent = 'A';
  const textColorInput = document.createElement('input');
  textColorInput.type = 'color';
  textColorInput.className = 'note-text-color';
  textColorInput.addEventListener('input', () => {
    if (!formatSelection(editor, 'color', textColorInput.value)) update({ textColor: textColorInput.value });
  });
  textColorLabel.appendChild(textColorInput);

  const sizeSelect = document.createElement('select');
  sizeSelect.className = 'note-font-size';
  sizeSelect.title = '文字の大きさ';
  for (const size of FONT_SIZES) {
    const opt = document.createElement('option');
    opt.value = size;
    opt.textContent = size + 'px';
    sizeSelect.appendChild(opt);
  }
  sizeSelect.addEventListener('change', () => {
    const size = Number(sizeSelect.value);
    if (formatSelection(editor, 'fontSize', size + 'px')) sync();
    else update({ fontSize: size });
  });

  // 現在の設定をコントロールに反映する
  const sync = () => {
    const color = note.color || DEFAULT_NOTE_COLOR;
    swatches.forEach((b) => b.classList.toggle('active', b.dataset.color === color));
    colorInput.value = color;
    textColorInput.value = note.textColor || DEFAULT_TEXT_COLOR;
    const size = note.fontSize || DEFAULT_FONT_SIZE;
    if (!FONT_SIZES.includes(size)) {
      const opt = document.createElement('option');
      opt.value = size;
      opt.textContent = size + 'px';
      sizeSelect.appendChild(opt);
    }
    sizeSelect.value = size;
  };
  sync();

  bar.append(...swatches, colorInput, textColorLabel, sizeSelect);
  // バー上の操作でドラッグや付箋作成が始まらないようにする
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());
  return bar;
}

// ヘッダー/リサイズハンドルのドラッグ処理。onMove(dx, dy, start) で付箋の矩形を更新する
function startDrag(e, note, el, onMove) {
  e.preventDefault();
  bringToFront(note, el);
  const startX = e.clientX;
  const startY = e.clientY;
  const start = { x: note.x, y: note.y, w: note.w, h: note.h };
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);

  const move = (ev) => {
    onMove(ev.clientX - startX, ev.clientY - startY, start);
    applyRect(note, el);
  };
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    save();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

function resizeBy(dir, note, dx, dy, start) {
  if (dir.includes('e')) note.w = Math.max(MIN_W, start.w + dx);
  if (dir.includes('s')) note.h = Math.max(MIN_H, start.h + dy);
  if (dir.includes('w')) note.w = Math.max(MIN_W, start.w - dx);
  if (dir.includes('n')) note.h = Math.max(MIN_H, start.h - dy);
  // 画像の付箋を四隅で拡大・縮小するときは縦横比を保つ（横方向の変化に合わせる）
  if (note.type === 'image' && dir.length === 2) {
    const ratio = start.w / start.h;
    note.h = note.w / ratio;
    if (note.h < MIN_H) {
      note.h = MIN_H;
      note.w = MIN_H * ratio;
    }
  }
  if (dir.includes('w')) note.x = start.x + start.w - note.w;
  if (dir.includes('n')) note.y = start.y + start.h - note.h;
}

function select(el) {
  document.querySelectorAll('.note.selected').forEach((n) => {
    if (n === el) return;
    n.classList.remove('selected');
    const editor = n.querySelector('.note-text');
    if (editor) savedRanges.delete(editor);
  });
  if (el) el.classList.add('selected');
}

function renderNote(note) {
  const el = document.createElement('div');
  const isImage = note.type === 'image';
  el.className = isImage ? 'note image' : 'note';
  el.dataset.id = note.id;
  el.style.zIndex = note.z;
  applyRect(note, el);

  let content;
  if (isImage) {
    content = document.createElement('img');
    content.className = 'note-image';
    content.src = note.image;
    content.alt = '';
    content.draggable = false;
  } else {
    content = document.createElement('div');
    content.className = 'note-text';
    content.contentEditable = 'true';
    content.spellcheck = false;
    content.innerHTML = noteHtml(note);
    content.addEventListener('input', () => {
      note.html = content.innerHTML;
      note.text = content.innerText;
      save();
    });
    // 文字の貼り付けは書式を持ち込まず、ただの文字として入れる（画像は別処理）
    content.addEventListener('paste', (e) => {
      const hasFile = Array.from(e.clipboardData.items).some((item) => item.kind === 'file');
      if (hasFile) return;
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
  }

  // 移動用：左上のグリップと枠線部分
  const grip = document.createElement('div');
  grip.className = 'note-grip';
  grip.title = 'ドラッグで移動';
  grip.textContent = '⠿';
  const edges = ['top', 'bottom', 'left', 'right'].map((side) => {
    const edge = document.createElement('div');
    edge.className = 'note-edge ' + side;
    return edge;
  });

  const close = document.createElement('button');
  close.className = 'note-close';
  close.type = 'button';
  close.title = '削除';
  close.textContent = '×';

  el.append(content, ...edges, grip, close);
  if (!isImage) el.appendChild(createStyleBar(note, el));
  applyStyle(note, el);
  for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const r = document.createElement('div');
    r.className = 'resizer ' + dir;
    r.addEventListener('pointerdown', (e) =>
      startDrag(e, note, el, (dx, dy, start) => resizeBy(dir, note, dx, dy, start)));
    el.appendChild(r);
  }

  const startMove = (e) => startDrag(e, note, el, (dx, dy, start) => {
    note.x = start.x + dx;
    note.y = start.y + dy;
  });
  grip.addEventListener('pointerdown', startMove);
  edges.forEach((edge) => edge.addEventListener('pointerdown', startMove));
  // 画像はどこをつかんでも移動できる
  if (isImage) content.addEventListener('pointerdown', startMove);

  close.addEventListener('pointerdown', (e) => e.stopPropagation());
  close.addEventListener('click', () => {
    if ((isImage || (note.text || '').trim()) && !confirm('この付箋を削除しますか？')) return;
    state.notes = state.notes.filter((n) => n.id !== note.id);
    el.remove();
    save();
  });

  el.addEventListener('pointerdown', () => {
    bringToFront(note, el);
    select(el);
  }, true);
  el.addEventListener('dblclick', (e) => e.stopPropagation());

  board.appendChild(el);
  return el;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function createNote(x, y) {
  const note = {
    id: newId(),
    x, y, w: 220, h: 180,
    z: ++topZ,
    text: '',
    html: '',
    color: DEFAULT_NOTE_COLOR,
    textColor: DEFAULT_TEXT_COLOR,
    fontSize: DEFAULT_FONT_SIZE,
  };
  state.notes.push(note);
  save();
  const el = renderNote(note);
  select(el);
  el.querySelector('.note-text').focus();
}

board.addEventListener('pointerdown', (e) => {
  if (e.target === board) select(null);
});

board.addEventListener('dblclick', (e) => {
  if (e.target !== board) return;
  createNote(e.clientX, e.clientY);
});

// ---- 画像の付箋 ----
const IMAGE_MAX_SIZE = 400; // 貼り付け直後の最大サイズ（長辺）

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageSize(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = src;
  });
}

// (x, y) を中心に画像の付箋を作る
async function createImageNote(file, x, y) {
  let image, size;
  try {
    image = await readAsDataURL(file);
    size = await imageSize(image);
  } catch (e) {
    alert('画像を貼り付けられませんでした。\n' + e.message);
    return;
  }
  const scale = Math.min(1, IMAGE_MAX_SIZE / Math.max(size.w, size.h));
  let w = Math.max(1, Math.round(size.w * scale));
  let h = Math.max(1, Math.round(size.h * scale));
  // 小さすぎる画像は最小サイズまで縦横比を保って広げる
  const up = Math.max(1, MIN_W / w, MIN_H / h);
  w = Math.round(w * up);
  h = Math.round(h * up);
  const note = {
    id: newId(),
    type: 'image',
    x: Math.round(x - w / 2),
    y: Math.round(y - h / 2),
    w, h,
    z: ++topZ,
    image,
  };
  state.notes.push(note);
  save();
  select(renderNote(note));
}

const imageFiles = (files) => Array.from(files || []).filter((f) => f.type.startsWith('image/'));

// ウィンドウへのドロップでファイルが開かれてしまうのを止める
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  imageFiles(e.dataTransfer.files).forEach((file, i) =>
    createImageNote(file, e.clientX + i * 20, e.clientY + i * 20));
});

// 貼り付け位置は最後にマウスがあった場所
let mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
document.addEventListener('pointermove', (e) => { mouse = { x: e.clientX, y: e.clientY }; });

document.addEventListener('paste', (e) => {
  const files = imageFiles(Array.from(e.clipboardData.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile()));
  if (!files.length) return; // 文字の貼り付けはそのまま
  e.preventDefault();
  files.forEach((file, i) => createImageNote(file, mouse.x + i * 20, mouse.y + i * 20));
});

// 現在の state でボード全体を描き直す
function renderAll() {
  board.querySelectorAll('.note').forEach((el) => el.remove());
  topZ = state.notes.reduce((z, n) => Math.max(z, n.z || 0), 0);
  setBackground(state.background || DEFAULT_BG);
  state.notes.forEach(renderNote);
}

// ---- ファイルへの保存・読み込み ----
const saveButton = document.getElementById('board-save');
const loadButton = document.getElementById('board-load');

async function saveToFile() {
  const data = { format: FILE_FORMAT, version: FILE_VERSION, background: state.background, notes: state.notes };
  try {
    await window.fusen.saveBoard(JSON.stringify(data, null, 2));
  } catch (e) {
    alert('保存できませんでした。\n' + e.message);
  }
}

async function loadFromFile() {
  let result;
  try {
    result = await window.fusen.loadBoard();
  } catch (e) {
    alert('ファイルを読み込めませんでした。\n' + e.message);
    return;
  }
  if (result.canceled) return;
  let data;
  try {
    data = JSON.parse(result.json);
  } catch (e) { /* 下で不正なファイルとして扱う */ }
  if (!data || data.format !== FILE_FORMAT || !Array.isArray(data.notes)) {
    alert('付箋黒板のファイルではありません。');
    return;
  }
  if (state.notes.length && !confirm('現在のボードを読み込んだ内容で置き換えますか？')) return;
  state = { background: data.background || DEFAULT_BG, notes: data.notes };
  renderAll();
  flushSave();
}

saveButton.addEventListener('click', saveToFile);
loadButton.addEventListener('click', loadFromFile);
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  const key = e.key.toLowerCase();
  if (key === 's') {
    e.preventDefault();
    saveToFile();
  } else if (key === 'o') {
    e.preventDefault();
    loadFromFile();
  }
});

// ---- 初期表示 ----
renderAll();
