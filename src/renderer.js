'use strict';

const DEFAULT_BG = '#2f5d3a';
const STORAGE_KEY = 'fusenkokuban';
const MIN_W = 60;
const MIN_H = 40;
const DEFAULT_NOTE_COLOR = '#fff59d';
const DEFAULT_TEXT_COLOR = '#222222';
const DEFAULT_FONT_SIZE = 15;
const NOTE_COLORS = ['#fff59d', '#ffcc80', '#f8bbd0', '#b3e5fc', '#c5e1a5', '#ffffff'];
const TEXT_COLORS = ['#222222', '#d32f2f', '#1976d2', '#388e3c', '#f57c00', '#7b1fa2', '#ffffff'];
const FONT_SIZES = [12, 15, 18, 24, 32, 48];
const FONT_SIZE_MIN = 6;
const FONT_SIZE_MAX = 200;
// Windows / macOS / Linux のどれかに入っているフォントを並べ、無ければ汎用フォントにフォールバックする
const FONT_FAMILIES = [
  ['', '標準'],
  ['"Hiragino Sans", "Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans CJK JP", sans-serif', 'ゴシック'],
  ['"Hiragino Mincho ProN", "Yu Mincho", "MS PMincho", "Noto Serif CJK JP", serif', '明朝'],
  ['"Hiragino Maru Gothic ProN", "BIZ UDGothic", Meiryo, "Noto Sans CJK JP", sans-serif', '丸ゴシック'],
  ['Consolas, Menlo, "DejaVu Sans Mono", "Noto Sans Mono", monospace', '等幅'],
  ['Arial, Helvetica, "Liberation Sans", sans-serif', 'Arial'],
  ['"Times New Roman", Times, "Liberation Serif", serif', 'Times New Roman'],
  ['Georgia, "DejaVu Serif", serif', 'Georgia'],
  ['Verdana, "DejaVu Sans", sans-serif', 'Verdana'],
  ['"Courier New", Courier, "Liberation Mono", monospace', 'Courier New'],
  ['"Comic Sans MS", "Comic Neue", cursive', 'Comic Sans'],
];
const STYLE_BAR_SPACE = 40; // 付箋の上にスタイルバーを出せる最小の余白
// 矢印は黒板に直接描くので、チョークのような明るい色を既定にする
const ARROW_COLORS = ['#ffffff', '#fff176', '#ef5350', '#42a5f5', '#66bb6a', '#ffa726', '#222222'];
const ARROW_WIDTHS = [[2, '細'], [4, '中'], [8, '太']];
const DEFAULT_ARROW_COLOR = '#ffffff';
const DEFAULT_ARROW_WIDTH = 4;
const ARROW_MIN_LENGTH = 10; // これより短いドラッグでは矢印を作らない

const board = document.getElementById('board');
const bgInput = document.getElementById('bg-color');
const bgReset = document.getElementById('bg-reset');

const FILE_FORMAT = 'fusenkokuban';
const FILE_VERSION = 1;

// 自動保存するのはタブで切り替える黒板の一覧（workspace）。state は表示中の黒板
let workspace = load();
let state = workspace.boards.find((b) => b.id === workspace.active) || workspace.boards[0];
workspace.active = state.id;
let topZ = 0;

function newBoard(name, background = DEFAULT_BG, notes = []) {
  return { id: newId(), name, background, notes };
}

// 「黒板1」「黒板2」…のうち、まだ使っていない名前
function nextBoardName(boards) {
  const used = new Set(boards.map((b) => b.name));
  let n = boards.length + 1;
  for (let i = 1; i < n; i++) if (!used.has('黒板' + i)) return '黒板' + i;
  while (used.has('黒板' + n)) n++;
  return '黒板' + n;
}

function parseState(json) {
  try {
    const data = JSON.parse(json);
    const boards = Array.isArray(data?.boards) ? data.boards.filter((b) => b && Array.isArray(b.notes)) : [];
    if (boards.length) {
      for (const b of boards) {
        b.id = b.id || newId();
        b.name = b.name || nextBoardName(boards.filter((x) => x.name));
        b.background = b.background || DEFAULT_BG;
      }
      return { version: 2, active: data.active, boards };
    }
    // 黒板が1枚だけだった旧版の形式
    if (data && Array.isArray(data.notes)) {
      return { version: 2, boards: [newBoard('黒板1', data.background || DEFAULT_BG, data.notes)] };
    }
  } catch (e) { /* 壊れたデータは無視 */ }
  return null;
}

function load() {
  // 旧版は localStorage に保存していたので、ファイルが無ければそちらから引き継ぐ
  return parseState(window.fusen.readState())
    || parseState(localStorage.getItem(STORAGE_KEY))
    || { version: 2, boards: [newBoard('黒板1')] };
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
  window.fusen.writeState(JSON.stringify(workspace)).catch(() => { /* 保存できなくても動作は継続 */ });
}

window.addEventListener('beforeunload', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    window.fusen.writeStateSync(JSON.stringify(workspace));
  }
});

// ---- 元に戻す・やり直し ----
// 変更の直前に state の写しを積む。画像などの文字列は共有されるので写しは軽い
// 履歴は黒板ごとに持ち、タブを切り替えるとその黒板の履歴に切り替わる
const HISTORY_LIMIT = 100;
const GROUP_MS = 1000; // 同じ操作が続く間（文字入力・色選び）は1回分にまとめる
const histories = new Map();
let undoStack;
let redoStack;
let lastRecord = { key: null, time: 0 };

function useHistory(boardId) {
  if (!histories.has(boardId)) histories.set(boardId, { undo: [], redo: [] });
  ({ undo: undoStack, redo: redoStack } = histories.get(boardId));
  lastRecord = { key: null, time: 0 };
}
useHistory(state.id);

function snapshot() {
  return { background: state.background, notes: state.notes.map((n) => ({ ...n })) };
}

// 変更する直前に呼ぶ。key を渡すと、同じ key が続く間は最初の1回だけ記録する
function recordHistory(key = null) {
  const now = Date.now();
  const grouped = key && key === lastRecord.key && now - lastRecord.time < GROUP_MS;
  lastRecord = { key, time: now };
  if (grouped) return;
  undoStack.push(snapshot());
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

function restore(from, to) {
  if (!from.length) return;
  // 文字入力中なら、戻したあとも同じ付箋の入力を続けられるようにする
  const focusedId = document.activeElement?.closest?.('.note')?.dataset.id;
  to.push(snapshot());
  const snap = from.pop();
  state.background = snap.background;
  state.notes = snap.notes;
  lastRecord = { key: null, time: 0 };
  closeContextMenu();
  renderAll();
  flushSave();
  const el = focusedId && board.querySelector(`.note[data-id="${focusedId}"]`);
  if (el) {
    select(el);
    const editor = el.querySelector('.note-text');
    if (editor) {
      editor.focus();
      const sel = window.getSelection();
      sel.selectAllChildren(editor);
      sel.collapseToEnd();
    }
  }
}

const undo = () => restore(undoStack, redoStack);
const redo = () => restore(redoStack, undoStack);

// ---- 背景色 ----
function setBackground(color) {
  state.background = color;
  board.style.background = color;
  bgInput.value = color;
  save();
}

bgInput.addEventListener('input', () => {
  recordHistory('background');
  setBackground(bgInput.value);
});
bgReset.addEventListener('click', () => {
  recordHistory();
  setBackground(DEFAULT_BG);
});

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
  text.style.fontFamily = note.fontFamily || '';
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
      const fontFamily = el.style.fontFamily;
      for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
      if (color) el.style.color = color;
      if (fontSize) el.style.fontSize = fontSize;
      if (fontFamily) el.style.fontFamily = fontFamily;
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

// 付箋ごとに、本文で最後に選択していた範囲（カーソル位置を含む）を覚えておく（色の選択などでフォーカスが外れても使えるように）
const savedRanges = new WeakMap();

const editorOf = (node) => node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('.note-text');

document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  // 付箋の外からドラッグして選んだときも、本文側の端から付箋を探す
  const editor = editorOf(sel.anchorNode) || editorOf(sel.focusNode);
  if (!editor) return;
  const range = sel.getRangeAt(0).cloneRange();
  if (!editor.contains(range.startContainer)) range.setStart(editor, 0);
  if (!editor.contains(range.endContainer)) range.setEnd(editor, editor.childNodes.length);
  savedRanges.set(editor, range);
  // カーソルが離れた、入力されなかった書式の目印を消す
  if (sel.isCollapsed) cleanPending(editor);
  editor.closest('.note')?.syncStyleBar?.();
});

// 範囲にかかる文字（テキストノード）を、範囲の境目で分けて返す
function textNodesInRange(editor, range) {
  const nodes = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t.data && range.intersectsNode(t)) nodes.push(t);
  }
  const { startContainer, startOffset, endContainer, endOffset } = range;
  return nodes.map((t) => {
    if (t === endContainer && endOffset < t.length) t.splitText(endOffset);
    if (t === startContainer && startOffset > 0) {
      if (startOffset >= t.length) return null;
      return t.splitText(startOffset);
    }
    if (t === endContainer && endOffset === 0) return null;
    return t;
  }).filter(Boolean);
}

// 本文の選択範囲があれば、その部分に書式（color / fontSize / fontFamily）を付けて true を返す
function formatSelection(editor, prop, value) {
  const range = savedRanges.get(editor);
  if (!range || range.collapsed || !editor.contains(range.commonAncestorContainer)) return false;
  const texts = textNodesInRange(editor, range);
  if (!texts.length) return false;
  recordHistory('format:' + prop);
  // 文字ごとに一番内側で書式を指定するので、外側に別の書式があっても必ずこちらが効く。
  // 行（div）をまたいでも行の構造は変えない
  for (const t of texts) {
    const parent = t.parentNode;
    if (parent !== editor && parent.tagName === 'SPAN' && parent.childNodes.length === 1) {
      parent.style[prop] = value;
    } else {
      const span = document.createElement('span');
      span.style[prop] = value;
      parent.insertBefore(span, t);
      span.appendChild(t);
    }
  }
  // 続けて別の書式も付けられるよう、書式を付けた部分を選択したままにする
  const r = document.createRange();
  r.setStart(texts[0], 0);
  const last = texts[texts.length - 1];
  r.setEnd(last, last.length);
  editor.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  savedRanges.set(editor, r.cloneRange());
  editor.dispatchEvent(new Event('input'));
  return true;
}

// 選択していないときは、カーソル位置にこれから入力する文字の書式を置く。
// 空の span には文字を入力できないので、目印のゼロ幅スペースを入れておき、入力後に取り除く
const PENDING = '\u200B';

function formatTyping(editor, prop, value) {
  let range = savedRanges.get(editor);
  if (!range || !editor.contains(range.startContainer)) {
    // まだカーソルを置いていなければ末尾から入力する
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  recordHistory('format:' + prop);
  const node = range.startContainer;
  let span;
  if (node.nodeType === Node.TEXT_NODE && node.data === PENDING
      && node.parentNode.tagName === 'SPAN' && node.parentNode.childNodes.length === 1) {
    // 続けて別の書式を選んだら、同じ場所の書式に重ねる
    span = node.parentNode;
  } else {
    span = document.createElement('span');
    span.appendChild(document.createTextNode(PENDING));
    range.collapse(true);
    range.insertNode(span);
  }
  span.style[prop] = value;
  editor.focus();
  const r = document.createRange();
  r.setStart(span.firstChild, PENDING.length);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  savedRanges.set(editor, r.cloneRange());
}

// 目印のゼロ幅スペースを片付ける。入力済みの文字からは取り除き、
// 何も入力されなかった書式（カーソルが離れたもの）は消す
function cleanPending(editor) {
  if (editor.dataset.composing) return;
  const sel = window.getSelection();
  const caret = sel.rangeCount ? sel.getRangeAt(0) : null;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t.data.includes(PENDING)) nodes.push(t);
  }
  for (const t of nodes) {
    const hasCaret = caret && caret.collapsed && caret.startContainer === t;
    if (t.data === PENDING) {
      if (hasCaret) continue;
      const parent = t.parentNode;
      t.remove();
      if (parent !== editor && parent.tagName === 'SPAN' && !parent.childNodes.length) parent.remove();
      continue;
    }
    const offset = hasCaret ? caret.startOffset - t.data.slice(0, caret.startOffset).split(PENDING).length + 1 : -1;
    t.data = t.data.split(PENDING).join('');
    if (hasCaret) sel.collapse(t, offset);
  }
}

// カーソル位置（選択範囲の先頭）の文字に効いている書式。部分指定が無ければ null
function formatAtCaret(editor, prop) {
  const range = savedRanges.get(editor);
  if (!range) return null;
  let node = range.collapsed ? range.startContainer : (textNodesAt(range) || range.startContainer);
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  for (; node && node !== editor && editor.contains(node); node = node.parentElement) {
    if (node.style && node.style[prop]) return node.style[prop];
    if (prop === 'color' && node.tagName === 'FONT' && node.getAttribute('color')) return node.getAttribute('color');
  }
  return null;
}

// 選択範囲にかかる最初の文字（テキストノード）を、分けずに探す
function textNodesAt(range) {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return root;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.data || !range.intersectsNode(t)) continue;
    if (t === range.startContainer && range.startOffset >= t.length) continue;
    return t;
  }
  return null;
}

// 要素に書いたフォント指定は表記が変わることがあるので、一覧の値に戻す
function normalizeFamily(family) {
  const probe = document.createElement('span');
  for (const [value] of FONT_FAMILIES) {
    probe.style.fontFamily = value;
    if (probe.style.fontFamily === family) return value;
  }
  return family;
}

function toHexColor(color) {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return color;
  return '#' + m.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('');
}

// 選択中の付箋に表示する、文字色・文字サイズ・フォントの変更バー（付箋の色は右クリックメニューで変える）
// 本文の一部を選択しているときは、その部分だけに適用する
function createStyleBar(note, el) {
  const bar = document.createElement('div');
  bar.className = 'note-style';
  const editor = el.querySelector('.note-text');

  // 本文の一部を選択していればその部分、なければカーソル位置からこれから入力する文字の書式を変える
  const applyFormat = (prop, value) => {
    if (!formatSelection(editor, prop, value)) formatTyping(editor, prop, value);
    sync();
  };
  const setTextColor = (color) => applyFormat('color', color);

  const swatches = TEXT_COLORS.map((color) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.title = '文字の色';
    b.dataset.color = color;
    b.style.background = color;
    // クリックで本文の選択が外れないようにする
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => setTextColor(color));
    return b;
  });

  const textColorLabel = document.createElement('label');
  textColorLabel.className = 'text-color';
  textColorLabel.title = '文字の色（自由に選ぶ）';
  textColorLabel.textContent = 'A';
  const textColorInput = document.createElement('input');
  textColorInput.type = 'color';
  textColorInput.className = 'note-text-color';
  textColorInput.addEventListener('input', () => setTextColor(textColorInput.value));
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
  const setFontSize = (size) => applyFormat('fontSize', size + 'px');
  sizeSelect.addEventListener('change', () => setFontSize(Number(sizeSelect.value)));

  // 一覧に無い大きさは数値で指定する（Enter / フォーカスを外す / 上下ボタンで反映）
  const sizeInput = document.createElement('input');
  sizeInput.type = 'number';
  sizeInput.className = 'note-font-size-input';
  sizeInput.title = '文字の大きさ（数値で指定）';
  sizeInput.min = FONT_SIZE_MIN;
  sizeInput.max = FONT_SIZE_MAX;
  sizeInput.step = 1;
  sizeInput.addEventListener('change', () => {
    const size = Math.round(Number(sizeInput.value));
    if (!sizeInput.value || !Number.isFinite(size)) return sync();
    setFontSize(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size)));
  });
  sizeInput.addEventListener('keydown', (e) => {
    // 反映時に本文へフォーカスが戻るので、Enter が本文の改行にならないようにする
    if (e.key === 'Enter') {
      e.preventDefault();
      sizeInput.blur();
    }
  });

  const fontSelect = document.createElement('select');
  fontSelect.className = 'note-font-family';
  fontSelect.title = 'フォント';
  for (const [value, label] of FONT_FAMILIES) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value) opt.style.fontFamily = value;
    fontSelect.appendChild(opt);
  }
  fontSelect.addEventListener('change', () => applyFormat('fontFamily', fontSelect.value));

  // 現在の設定をコントロールに反映する。本文を選択中・入力中は、その位置の文字の書式を出す
  const sync = () => {
    const caretColor = formatAtCaret(editor, 'color');
    const caretSize = parseFloat(formatAtCaret(editor, 'fontSize'));
    const caretFamily = formatAtCaret(editor, 'fontFamily');
    const textColor = caretColor ? toHexColor(caretColor) : note.textColor || DEFAULT_TEXT_COLOR;
    swatches.forEach((b) => b.classList.toggle('active', b.dataset.color === textColor));
    textColorInput.value = textColor;
    const size = caretSize ? Math.round(caretSize) : note.fontSize || DEFAULT_FONT_SIZE;
    if (!Array.from(sizeSelect.options).some((opt) => Number(opt.value) === size)) {
      const opt = document.createElement('option');
      opt.value = size;
      opt.textContent = size + 'px';
      sizeSelect.appendChild(opt);
    }
    sizeSelect.value = size;
    sizeInput.value = size;
    const family = caretFamily != null ? normalizeFamily(caretFamily) : note.fontFamily || '';
    if (!Array.from(fontSelect.options).some((opt) => opt.value === family)) {
      const opt = document.createElement('option');
      opt.value = family;
      opt.textContent = family;
      fontSelect.appendChild(opt);
    }
    fontSelect.value = family;
  };
  sync();
  // 右クリックメニューなど、バーの外から変更したときに表示を合わせる
  el.syncStyleBar = sync;

  bar.append(...swatches, textColorLabel, sizeSelect, sizeInput, fontSelect);
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

  let moved = false;
  const move = (ev) => {
    if (!moved) {
      moved = true;
      recordHistory();
    }
    onMove(ev.clientX - startX, ev.clientY - startY, start);
    applyRect(note, el);
  };
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    if (moved) save();
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
  document.querySelectorAll('.note.selected, .arrow.selected').forEach((n) => {
    if (n === el) return;
    n.classList.remove('selected');
    const editor = n.querySelector('.note-text');
    if (editor) savedRanges.delete(editor);
  });
  if (el) el.classList.add('selected');
}

function renderNote(note) {
  if (note.type === 'arrow') return renderArrow(note);
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
    content.addEventListener('beforeinput', () => recordHistory('text:' + note.id));
    content.addEventListener('input', (e) => {
      // 変換中に文字を触ると入力が崩れるので、確定してから目印を片付ける
      if (!e.isComposing) cleanPending(content);
      note.html = content.innerHTML.split(PENDING).join('');
      note.text = content.innerText.split(PENDING).join('');
      save();
    });
    content.addEventListener('compositionstart', () => { content.dataset.composing = '1'; });
    content.addEventListener('compositionend', () => setTimeout(() => {
      delete content.dataset.composing;
      cleanPending(content);
      content.dispatchEvent(new Event('input'));
    }));
    // Esc で文字入力を終えて、付箋の選択表示（拡大縮小ハンドル）に戻す
    content.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.isComposing) content.blur();
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

  const startMove = (e) => {
    // 枠をつかんだら文字入力を終えて、拡大縮小ハンドルを出す
    if (el.contains(document.activeElement)) document.activeElement.blur();
    startDrag(e, note, el, (dx, dy, start) => {
      note.x = start.x + dx;
      note.y = start.y + dy;
    });
  };
  grip.addEventListener('pointerdown', startMove);
  edges.forEach((edge) => edge.addEventListener('pointerdown', startMove));
  // 画像はどこをつかんでも移動できる
  if (isImage) content.addEventListener('pointerdown', startMove);

  close.addEventListener('pointerdown', (e) => e.stopPropagation());
  close.addEventListener('click', () => deleteNote(note, el));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    bringToFront(note, el);
    select(el);
    openContextMenu(note, el, e.clientX, e.clientY);
  });

  el.addEventListener('pointerdown', () => {
    bringToFront(note, el);
    select(el);
  }, true);
  el.addEventListener('dblclick', (e) => e.stopPropagation());

  board.appendChild(el);
  return el;
}

function deleteNote(note, el) {
  recordHistory();
  state.notes = state.notes.filter((n) => n.id !== note.id);
  el.remove();
  save();
}

function setNoteColor(note, el, color) {
  recordHistory();
  note.color = color;
  applyStyle(note, el);
  if (el.syncStyleBar) el.syncStyleBar();
  save();
}

// 付箋をウィンドウの端（left / right / top / bottom）に寄せる
const EDGE_MARGIN = 10;
function moveToEdge(note, el, side) {
  recordHistory();
  if (side === 'left') note.x = EDGE_MARGIN;
  if (side === 'right') note.x = window.innerWidth - note.w - EDGE_MARGIN;
  if (side === 'top') note.y = EDGE_MARGIN;
  if (side === 'bottom') note.y = window.innerHeight - note.h - EDGE_MARGIN;
  applyRect(note, el);
  save();
}

// ---- 右クリックメニュー ----
const contextMenu = document.createElement('div');
contextMenu.id = 'context-menu';
contextMenu.hidden = true;
document.body.appendChild(contextMenu);

function closeContextMenu() {
  contextMenu.hidden = true;
  contextMenu.replaceChildren();
}

function openContextMenu(note, el, x, y) {
  closeContextMenu();
  const item = (label, ...children) => {
    const row = document.createElement('div');
    row.className = 'menu-row';
    const name = document.createElement('span');
    name.className = 'menu-label';
    name.textContent = label;
    row.append(name, ...children);
    contextMenu.appendChild(row);
    return row;
  };
  const button = (text, title, onClick, className = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', () => {
      closeContextMenu();
      onClick();
    });
    return b;
  };

  if (note.type === 'arrow') {
    item('色を変える', ...ARROW_COLORS.map((color) => {
      const b = button('', color, () => setArrowStyle(note, el, { color }), 'swatch');
      b.dataset.color = color;
      b.style.background = color;
      b.classList.toggle('active', (note.color || DEFAULT_ARROW_COLOR) === color);
      return b;
    }));
    item('太さ', ...ARROW_WIDTHS.map(([width, text]) => {
      const b = button(text, `太さ ${width}px`, () => setArrowStyle(note, el, { width }), 'edge');
      b.dataset.width = width;
      b.classList.toggle('active', (note.width || DEFAULT_ARROW_WIDTH) === width);
      return b;
    }));
    const flipRow = item('向きを反転');
    flipRow.classList.add('menu-action', 'menu-flip');
    flipRow.addEventListener('click', () => {
      closeContextMenu();
      flipArrow(note, el);
    });
    const removeRow = item('矢印を消す');
    removeRow.classList.add('menu-action', 'menu-close');
    removeRow.addEventListener('click', () => {
      closeContextMenu();
      deleteNote(note, el);
    });
    showContextMenu(x, y);
    return;
  }

  if (note.type !== 'image') {
    item('色を変える', ...NOTE_COLORS.map((color) => {
      const b = button('', color, () => setNoteColor(note, el, color), 'swatch');
      b.dataset.color = color;
      b.style.background = color;
      b.classList.toggle('active', (note.color || DEFAULT_NOTE_COLOR) === color);
      return b;
    }));
  }
  item('端に寄せる', ...[['left', '左', '左端に寄せる'], ['right', '右', '右端に寄せる'],
    ['top', '上', '上端に寄せる'], ['bottom', '下', '下端に寄せる']]
    .map(([side, text, title]) => {
      const b = button(text, title, () => moveToEdge(note, el, side), 'edge');
      b.dataset.side = side;
      return b;
    }));
  const closeRow = item('付箋を閉じる');
  closeRow.classList.add('menu-action', 'menu-close');
  closeRow.addEventListener('click', () => {
    closeContextMenu();
    deleteNote(note, el);
  });
  showContextMenu(x, y);
}

function showContextMenu(x, y) {
  contextMenu.hidden = false;
  // 画面からはみ出さない位置に出す
  const { width, height } = contextMenu.getBoundingClientRect();
  contextMenu.style.left = Math.max(0, Math.min(x, window.innerWidth - width - 4)) + 'px';
  contextMenu.style.top = Math.max(0, Math.min(y, window.innerHeight - height - 4)) + 'px';
}

contextMenu.addEventListener('pointerdown', (e) => e.stopPropagation());
contextMenu.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerdown', closeContextMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeContextMenu();
    setArrowMode(false);
  }
});
// 選択中の付箋を Delete で削除（Mac は Backspace でも）。文字入力中は文字の削除として扱う
const IS_MAC = navigator.userAgent.includes('Mac');
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
  if (!(e.key === 'Delete' || (IS_MAC && e.key === 'Backspace'))) return;
  const active = document.activeElement;
  if (active && (active.isContentEditable || active.matches('input, textarea, select'))) return;
  const el = board.querySelector('.note.selected, .arrow.selected');
  const note = el && state.notes.find((n) => n.id === el.dataset.id);
  if (!note) return;
  e.preventDefault();
  closeContextMenu();
  deleteNote(note, el);
});
window.addEventListener('resize', closeContextMenu);
window.addEventListener('blur', closeContextMenu);

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
  recordHistory();
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
  if (e.target !== board || arrowMode) return;
  createNote(e.clientX, e.clientY);
});

// ---- 矢印 ----
// 付箋とは別の図形として、始点 (x1, y1) から終点 (x2, y2) へ黒板に直接描く。
// 付箋と同じ notes に type: 'arrow' で入れるので、重なり順・元に戻す・保存は付箋と共通
const SVG_NS = 'http://www.w3.org/2000/svg';
const arrowToolButton = document.getElementById('arrow-tool');
let arrowMode = false;

function svg(tag, className) {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute('class', className);
  return node;
}

function setArrowMode(on) {
  arrowMode = on;
  arrowToolButton.classList.toggle('active', on);
  board.classList.toggle('arrow-mode', on);
}

arrowToolButton.addEventListener('click', () => setArrowMode(!arrowMode));

// 矢じりの大きさは線の太さに合わせる
const arrowHeadLength = (width) => 8 + width * 3;

function applyArrow(note, el) {
  const width = note.width || DEFAULT_ARROW_WIDTH;
  const color = note.color || DEFAULT_ARROW_COLOR;
  const { x1, y1, x2, y2 } = note;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const head = Math.min(arrowHeadLength(width), len);
  const half = head * 0.55;
  // 線の先が矢じりからはみ出さないよう、矢じりの途中で止める
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const lx = x2 - ux * head * 0.7;
  const ly = y2 - uy * head * 0.7;
  const set = (node, attrs) => Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  set(el.querySelector('.arrow-hit'), { x1, y1, x2, y2, 'stroke-width': Math.max(14, width + 10) });
  set(el.querySelector('.arrow-line'), { x1, y1, x2: lx, y2: ly, stroke: color, 'stroke-width': width });
  set(el.querySelector('.arrow-head'), {
    fill: color,
    points: [[x2, y2], [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]]
      .map((p) => p.join(',')).join(' '),
  });
  set(el.querySelector('.arrow-handle.start'), { cx: x1, cy: y1 });
  set(el.querySelector('.arrow-handle.end'), { cx: x2, cy: y2 });
}

function renderArrow(note) {
  const el = document.createElement('div');
  el.className = 'arrow';
  el.dataset.id = note.id;
  el.style.zIndex = note.z;
  const root = svg('svg', 'arrow-svg');
  const hit = svg('line', 'arrow-hit');
  const line = svg('line', 'arrow-line');
  const head = svg('polygon', 'arrow-head');
  const start = svg('circle', 'arrow-handle start');
  const end = svg('circle', 'arrow-handle end');
  start.setAttribute('r', 6);
  end.setAttribute('r', 6);
  root.append(line, head, hit, start, end);
  el.appendChild(root);
  applyArrow(note, el);

  // 線をつかむと移動、両端の丸をつかむとその端だけ動かす
  for (const part of [hit, line, head]) part.addEventListener('pointerdown', (e) => startArrowDrag(e, note, el, 'move'));
  start.addEventListener('pointerdown', (e) => startArrowDrag(e, note, el, 'start'));
  end.addEventListener('pointerdown', (e) => startArrowDrag(e, note, el, 'end'));
  el.addEventListener('pointerdown', () => {
    bringToFront(note, el);
    select(el);
  }, true);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    bringToFront(note, el);
    select(el);
    openContextMenu(note, el, e.clientX, e.clientY);
  });
  el.addEventListener('dblclick', (e) => e.stopPropagation());
  board.appendChild(el);
  return el;
}

// Shift を押しながらだと 45° 刻みにそろえる
function snapAngle(fx, fy, x, y) {
  const len = Math.hypot(x - fx, y - fy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(y - fy, x - fx) / step) * step;
  return [Math.round(fx + Math.cos(angle) * len), Math.round(fy + Math.sin(angle) * len)];
}

function startArrowDrag(e, note, el, mode) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  bringToFront(note, el);
  select(el);
  const startX = e.clientX;
  const startY = e.clientY;
  const start = { x1: note.x1, y1: note.y1, x2: note.x2, y2: note.y2 };
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);

  let moved = false;
  const move = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!moved) {
      moved = true;
      recordHistory();
    }
    if (mode === 'move') {
      Object.assign(note, { x1: start.x1 + dx, y1: start.y1 + dy, x2: start.x2 + dx, y2: start.y2 + dy });
    } else {
      const [fx, fy] = mode === 'start' ? [start.x2, start.y2] : [start.x1, start.y1];
      let x = (mode === 'start' ? start.x1 : start.x2) + dx;
      let y = (mode === 'start' ? start.y1 : start.y2) + dy;
      if (ev.shiftKey) [x, y] = snapAngle(fx, fy, x, y);
      if (mode === 'start') Object.assign(note, { x1: x, y1: y });
      else Object.assign(note, { x2: x, y2: y });
    }
    applyArrow(note, el);
  };
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    if (moved) save();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

// 矢印モード中は、付箋の上からでもドラッグで矢印を引ける（付箋同士を指す矢印を描けるように）
board.addEventListener('pointerdown', (e) => {
  if (!arrowMode || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  closeContextMenu();
  const x1 = e.clientX;
  const y1 = e.clientY;
  let note = null;
  let el = null;
  board.setPointerCapture(e.pointerId);
  const move = (ev) => {
    let [x2, y2] = [ev.clientX, ev.clientY];
    if (ev.shiftKey) [x2, y2] = snapAngle(x1, y1, x2, y2);
    if (!note) {
      if (Math.hypot(x2 - x1, y2 - y1) < ARROW_MIN_LENGTH) return;
      note = { id: newId(), type: 'arrow', x1, y1, x2, y2, z: ++topZ,
        color: DEFAULT_ARROW_COLOR, width: DEFAULT_ARROW_WIDTH };
      recordHistory();
      state.notes.push(note);
      el = renderArrow(note);
      select(el);
    }
    Object.assign(note, { x2, y2 });
    applyArrow(note, el);
  };
  const up = () => {
    board.removeEventListener('pointermove', move);
    board.removeEventListener('pointerup', up);
    board.removeEventListener('pointercancel', up);
    if (note) {
      save();
      setArrowMode(false);
    }
  };
  board.addEventListener('pointermove', move);
  board.addEventListener('pointerup', up);
  board.addEventListener('pointercancel', up);
}, true);

function setArrowStyle(note, el, style) {
  recordHistory();
  Object.assign(note, style);
  applyArrow(note, el);
  save();
}

function flipArrow(note, el) {
  recordHistory();
  Object.assign(note, { x1: note.x2, y1: note.y2, x2: note.x1, y2: note.y1 });
  applyArrow(note, el);
  save();
}

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
  recordHistory();
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
  board.querySelectorAll('.note, .arrow').forEach((el) => el.remove());
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
  recordHistory();
  state.background = data.background || DEFAULT_BG;
  state.notes = data.notes;
  renderAll();
  flushSave();
}

// ---- 画像として書き出し ----
// 範囲は表示中の画面（黒板）。ツールバーや選択ハンドルなどの UI は写さない
const exportButton = document.getElementById('board-export');
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function exportImage() {
  let png;
  document.body.classList.add('exporting');
  try {
    // UI を隠した状態が描画されてから撮る
    await nextFrame();
    await nextFrame();
    png = await window.fusen.captureBoard();
  } catch (e) {
    alert('画像を作成できませんでした。\n' + e.message);
    return;
  } finally {
    document.body.classList.remove('exporting');
  }
  try {
    await window.fusen.exportImage(png, state.name);
  } catch (e) {
    alert('画像を保存できませんでした。\n' + e.message);
  }
}

exportButton.addEventListener('click', exportImage);
saveButton.addEventListener('click', saveToFile);
loadButton.addEventListener('click', loadFromFile);
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  // Ctrl+Tab / Ctrl+Shift+Tab で黒板のタブを切り替える
  if (key === 'tab' && e.ctrlKey) {
    e.preventDefault();
    cycleBoard(e.shiftKey ? -1 : 1);
    return;
  }
  // タブ名の入力中は、入力欄の標準の操作に任せる
  if (e.target.closest?.('#tabs')) return;
  // 元に戻す: Ctrl/Cmd+Z、やり直し: Ctrl/Cmd+Y または Ctrl/Cmd+Shift+Z
  // 文字入力中もブラウザ標準の取り消しではなく、ボード全体の履歴で戻す
  if (key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (key === 'y' && !e.shiftKey) {
    e.preventDefault();
    redo();
    return;
  }
  if (e.shiftKey) return;
  if (key === 's') {
    e.preventDefault();
    saveToFile();
  } else if (key === 'o') {
    e.preventDefault();
    loadFromFile();
  } else if (key === 'e') {
    e.preventDefault();
    exportImage();
  }
});

// ---- 黒板のタブ ----
const tabBar = document.getElementById('tabs');

function switchBoard(id) {
  const next = workspace.boards.find((b) => b.id === id);
  if (!next || next === state) return;
  // 入力中の文字やタブ名を確定してから切り替える
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  closeContextMenu();
  state = next;
  workspace.active = id;
  useHistory(id);
  renderAll();
  renderTabs();
  save();
}

function cycleBoard(step) {
  const { boards } = workspace;
  const i = boards.indexOf(state);
  switchBoard(boards[(i + step + boards.length) % boards.length].id);
}

function addBoard() {
  const b = newBoard(nextBoardName(workspace.boards));
  workspace.boards.push(b);
  switchBoard(b.id);
  tabBar.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest' });
}

function deleteBoard(b) {
  const { boards } = workspace;
  if (boards.length <= 1) return;
  if (b.notes.length && !confirm(`「${b.name}」を削除しますか？\n貼ってある付箋もすべて消え、元に戻せません。`)) return;
  const i = boards.indexOf(b);
  boards.splice(i, 1);
  histories.delete(b.id);
  if (b === state) {
    state = null;
    switchBoard(boards[Math.min(i, boards.length - 1)].id);
  } else {
    renderTabs();
    save();
  }
}

// タブ名をその場で書き換える（Enter / フォーカスを外すで確定、Esc で取り消し）
function startRename(b, label) {
  const input = document.createElement('input');
  input.className = 'tab-rename';
  input.value = b.name;
  input.maxLength = 50;
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (commit && name && name !== b.name) {
      b.name = name;
      save();
    }
    renderTabs();
  };
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
  label.replaceWith(input);
  input.focus();
  input.select();
}

function renderTabs() {
  tabBar.replaceChildren();
  for (const b of workspace.boards) {
    const tab = document.createElement('div');
    tab.className = b === state ? 'tab active' : 'tab';
    tab.dataset.id = b.id;
    tab.title = 'クリックで切り替え／ダブルクリックで名前を変更';
    const label = document.createElement('span');
    label.className = 'tab-name';
    label.textContent = b.name;
    tab.appendChild(label);
    if (workspace.boards.length > 1) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.title = '黒板を削除';
      close.textContent = '×';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteBoard(b);
      });
      close.addEventListener('dblclick', (e) => e.stopPropagation());
      tab.appendChild(close);
    }
    tab.addEventListener('click', () => switchBoard(b.id));
    tab.addEventListener('dblclick', () => startRename(b, label));
    tabBar.appendChild(tab);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.id = 'tab-add';
  add.title = '黒板を追加';
  add.textContent = '+';
  add.addEventListener('click', addBoard);
  tabBar.appendChild(add);
}

// ---- 初期表示 ----
renderAll();
renderTabs();
