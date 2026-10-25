'use strict';

const DEFAULT_BG = '#2f5d3a';
const STORAGE_KEY = 'fusenkokuban';
const MIN_W = 120;
const MIN_H = 80;

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

function renderNote(note) {
  const el = document.createElement('div');
  el.className = 'note';
  el.dataset.id = note.id;
  el.style.zIndex = note.z;
  applyRect(note, el);

  const header = document.createElement('div');
  header.className = 'note-header';
  const close = document.createElement('button');
  close.className = 'note-close';
  close.type = 'button';
  close.title = '削除';
  close.textContent = '×';
  header.appendChild(close);

  const text = document.createElement('textarea');
  text.className = 'note-text';
  text.value = note.text;
  text.spellcheck = false;

  el.append(header, text);
  for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const r = document.createElement('div');
    r.className = 'resizer ' + dir;
    r.addEventListener('pointerdown', (e) =>
      startDrag(e, note, el, (dx, dy, start) => resizeBy(dir, note, dx, dy, start)));
    el.appendChild(r);
  }

  header.addEventListener('pointerdown', (e) => {
    if (e.target === close) return;
    startDrag(e, note, el, (dx, dy, start) => {
      note.x = start.x + dx;
      note.y = start.y + dy;
    });
  });

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
  el.addEventListener('pointerdown', () => bringToFront(note, el), true);
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
  };
  state.notes.push(note);
  save();
  const el = renderNote(note);
  el.querySelector('.note-text').focus();
}

board.addEventListener('dblclick', (e) => {
  if (e.target !== board) return;
  createNote(e.clientX, e.clientY);
});

// ---- 初期表示 ----
setBackground(state.background || DEFAULT_BG);
state.notes.forEach(renderNote);
