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

let state = load();
let topZ = state.notes.reduce((z, n) => Math.max(z, n.z || 0), 0);

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.notes)) return data;
  } catch (e) { /* 壊れたデータは無視して初期化 */ }
  return { background: DEFAULT_BG, notes: [] };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* 保存できなくても動作は継続 */ }
}

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
  const text = el.querySelector('.note-text');
  el.style.background = note.color || DEFAULT_NOTE_COLOR;
  text.style.color = note.textColor || DEFAULT_TEXT_COLOR;
  text.style.fontSize = (note.fontSize || DEFAULT_FONT_SIZE) + 'px';
}

// 選択中の付箋に表示する、背景色・文字色・文字サイズの変更バー
function createStyleBar(note, el) {
  const bar = document.createElement('div');
  bar.className = 'note-style';

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
  textColorInput.addEventListener('input', () => update({ textColor: textColorInput.value }));
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
  sizeSelect.addEventListener('change', () => update({ fontSize: Number(sizeSelect.value) }));

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
  if (dir.includes('w')) {
    note.w = Math.max(MIN_W, start.w - dx);
    note.x = start.x + start.w - note.w;
  }
  if (dir.includes('n')) {
    note.h = Math.max(MIN_H, start.h - dy);
    note.y = start.y + start.h - note.h;
  }
}

function select(el) {
  document.querySelectorAll('.note.selected').forEach((n) => {
    if (n !== el) n.classList.remove('selected');
  });
  if (el) el.classList.add('selected');
}

function renderNote(note) {
  const el = document.createElement('div');
  el.className = 'note';
  el.dataset.id = note.id;
  el.style.zIndex = note.z;
  applyRect(note, el);

  const text = document.createElement('textarea');
  text.className = 'note-text';
  text.value = note.text;
  text.spellcheck = false;

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

  el.append(text, ...edges, grip, close, createStyleBar(note, el));
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

  close.addEventListener('pointerdown', (e) => e.stopPropagation());
  close.addEventListener('click', () => {
    if (note.text && !confirm('この付箋を削除しますか？')) return;
    state.notes = state.notes.filter((n) => n.id !== note.id);
    el.remove();
    save();
  });

  text.addEventListener('input', () => {
    note.text = text.value;
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

function createNote(x, y) {
  const note = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    x, y, w: 220, h: 180,
    z: ++topZ,
    text: '',
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

// ---- 初期表示 ----
setBackground(state.background || DEFAULT_BG);
state.notes.forEach(renderNote);
