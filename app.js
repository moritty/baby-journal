'use strict';

// ===== 設定 =====
const CONFIG = {
  babyName: 'Kotone',
  birthDate: new Date(2026, 1, 9), // 2026-02-09 (monthは0始まり)
  get scriptUrl() {
    return localStorage.getItem('scriptUrl') ||
      'https://script.google.com/macros/s/AKfycbzJUZideDfqkI0-JZ5-5kenYG_oPeTAFKwS2XvaOC9WAjiytZSAaKLwdV_A81c7SfwC/exec';
  },
};

// ===== カテゴリ定義 =====
const CATS = [
  { id: 'breast',   label: '母乳',     emoji: '🤱', color: '#E8758A', bg: '#FCE4EC' },
  { id: 'milk',     label: 'ミルク',   emoji: '🍼', color: '#E8758A', bg: '#FCE4EC' },
  { id: 'pump',     label: 'さく乳',   emoji: '🥛', color: '#C3A8D1', bg: '#EDE7F6' },
  { id: 'food',     label: 'ごはん',   emoji: '🥄', color: '#C3A8D1', bg: '#EDE7F6' },
  { id: 'sleep',    label: '寝る',     emoji: '🌙', color: '#7EC8D4', bg: '#E0F7FA' },
  { id: 'wake',     label: '起きる',   emoji: '☀️',  color: '#FFB74D', bg: '#FFF3E0' },
  { id: 'poop',     label: 'うんち',   emoji: '💩', color: '#81C784', bg: '#E8F5E9' },
  { id: 'pee',      label: 'おしっこ', emoji: '💧', color: '#7EC8D4', bg: '#E0F7FA' },
  { id: 'bath',     label: 'お風呂',   emoji: '🛁', color: '#7EC8D4', bg: '#E0F7FA' },
  { id: 'temp',     label: '体温',     emoji: '🌡️',  color: '#FF7043', bg: '#FBE9E7' },
  { id: 'medicine', label: '薬',       emoji: '💊', color: '#FFB74D', bg: '#FFF3E0' },
  { id: 'weight',   label: '体重',     emoji: '⚖️',  color: '#F48FB1', bg: '#FCE4EC' },
  { id: 'height',   label: '身長',     emoji: '📏', color: '#7EC8D4', bg: '#E0F7FA' },
  { id: 'diary',    label: '日記',     emoji: '📖', color: '#9FA8DA', bg: '#E8EAF6' },
  { id: 'memo',     label: 'メモ',     emoji: '📝', color: '#80CBC4', bg: '#E0F2F1' },
  { id: 'hitokoto', label: 'ひとこと', emoji: '✏️',  color: '#999',    bg: '#EEEEEE' },
];

const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));

// 入力方式分類
const TIME_ONLY = new Set(['poop', 'pee', 'sleep', 'wake', 'bath']);
const WITH_ML   = new Set(['breast', 'milk', 'pump']);
const WITH_NOTE = new Set(['food', 'diary', 'memo', 'medicine']);
const WITH_TEMP   = new Set(['temp']);
const WITH_HEIGHT = new Set(['height']);

// ===== 状態 =====
const state = {
  date: today(),
  records: {},       // { 'YYYY-MM-DD': Record[] }
  expanded: new Set(),
  syncing: false,
};

// モーダル状態
const modal = { catId: null, step: 0, time: null };

// ===== 日付ヘルパー =====
function today() {
  const d = new Date();
  return ymd(d);
}

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}

function formatJP(dateStr) {
  const d = parseDateStr(dateStr);
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}

function daysOld(dateStr) {
  const d = parseDateStr(dateStr);
  const birth = CONFIG.birthDate;
  const born = new Date(birth.getFullYear(), birth.getMonth(), birth.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((target - born) / 86400000);
}

function babyAgeText(dateStr) {
  const d = parseDateStr(dateStr);
  const b = CONFIG.birthDate;
  let y = d.getFullYear() - b.getFullYear();
  let m = d.getMonth() - b.getMonth();
  if (m < 0) { y--; m += 12; }
  return `${CONFIG.babyName} ${y}才${m}ヶ月`;
}

function addDays(dateStr, delta) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + delta);
  return ymd(d);
}

function nowTime() {
  const n = new Date();
  return `${pad(n.getHours())}:${pad(n.getMinutes())}`;
}

// ===== ローカルキャッシュ =====
function saveCache() {
  try { localStorage.setItem('records_v2', JSON.stringify(state.records)); } catch(e) {}
}

function loadCache() {
  try {
    const d = localStorage.getItem('records_v2');
    if (d) state.records = JSON.parse(d);
  } catch(e) {}
}

// ===== Google Apps Script API =====
async function syncFetch(dateStr) {
  if (!CONFIG.scriptUrl) return;
  setSyncing(true);
  try {
    const res = await fetch(`${CONFIG.scriptUrl}?action=get&date=${dateStr}`);
    const data = await res.json();
    if (Array.isArray(data.records)) {
      // マージ: Sheetsにないローカルデータは残す（消えるのを防ぐ）
      const sheetsIds = new Set(data.records.map(r => r.id));
      const localOnly = (state.records[dateStr] || []).filter(r => !sheetsIds.has(r.id));
      state.records[dateStr] = [...data.records, ...localOnly]
        .sort((a, b) => a.time.localeCompare(b.time));
      saveCache();
      // ローカルにしかないレコードはSheetsに再送する
      for (const r of localOnly) syncSave(r);
      renderTimeline();
      renderSummary();
    }
  } catch(e) {
    console.warn('fetch error', e);
  } finally {
    setSyncing(false);
  }
}

async function syncSave(record) {
  if (!CONFIG.scriptUrl) return;
  try {
    // GETパラメータで送信（POSTより確実にSheetsに届く）
    const url = `${CONFIG.scriptUrl}?action=save&data=${encodeURIComponent(JSON.stringify(record))}`;
    await fetch(url);
  } catch(e) {
    console.warn('save error', e);
  }
}

async function syncDelete(id) {
  if (!CONFIG.scriptUrl) return;
  try {
    await fetch(`${CONFIG.scriptUrl}?action=delete&id=${encodeURIComponent(id)}`);
  } catch(e) {}
}

function setSyncing(v) {
  state.syncing = v;
  const badge = document.getElementById('syncBadge');
  if (badge) badge.style.display = v ? 'block' : 'none';
}

// ===== レコード操作 =====
function addRecord(record) {
  const dk = record.date;
  if (!state.records[dk]) state.records[dk] = [];
  state.records[dk].push(record);
  // 時刻順に並べる
  state.records[dk].sort((a, b) => a.time.localeCompare(b.time));
  saveCache();
  renderTimeline();
  renderSummary();
  syncSave(record);
}

function removeRecord(id) {
  for (const dk in state.records) {
    const before = state.records[dk].length;
    state.records[dk] = state.records[dk].filter(r => r.id !== id);
    if (state.records[dk].length < before) {
      saveCache();
      renderTimeline();
      renderSummary();
      syncDelete(id);
      return;
    }
  }
}

// ===== 描画 =====
function renderAll() {
  const dk = state.date;
  document.getElementById('babyNameAge').textContent = babyAgeText(dk);
  document.getElementById('currentDateLabel').textContent = formatJP(dk);
  const days = daysOld(dk);
  document.getElementById('daysOldLabel').textContent = days >= 0 ? `生後${days}日目` : '';
  renderSummary();
  renderTimeline();
  renderCatGrid();
}

function renderSummary() {
  const records = state.records[state.date] || [];
  const el = document.getElementById('dailySummary');

  if (records.length === 0) {
    el.innerHTML = '<span class="summary-empty">まだ記録がありません</span>';
    return;
  }

  const counts = {}, totals = {};
  for (const r of records) {
    counts[r.category] = (counts[r.category] || 0) + 1;
    if (r.value) totals[r.category] = (totals[r.category] || 0) + Number(r.value);
  }

  el.innerHTML = Object.entries(counts).map(([id, cnt]) => {
    const c = CAT[id] || CATS[0];
    let sub = `${cnt}回`;
    if (id === 'hitokoto') sub = 'あり';
    else if (WITH_ML.has(id) && totals[id]) sub = `${cnt}回<br>${totals[id]}ml`;
    else if (id === 'weight' && totals[id]) sub = `${totals[id]}g`;
    else if (id === 'temp' && totals[id]) sub = `${(totals[id]/cnt).toFixed(1)}℃`;
    else if (id === 'height' && totals[id]) sub = `${(totals[id]/cnt).toFixed(1)}cm`;
    return `
      <div class="summary-item">
        <div class="summary-icon" style="background:${c.bg}">${c.emoji}</div>
        <div class="summary-count">${sub}</div>
      </div>`;
  }).join('');
}

function renderTimeline() {
  const records = state.records[state.date] || [];
  const el = document.getElementById('timeline');

  // ひとことと通常レコードを分離
  const hitokotoByHour = {};
  const byHour = {};
  for (const r of records) {
    const h = parseInt(r.time.split(':')[0], 10);
    if (r.category === 'hitokoto') {
      if (!hitokotoByHour[h]) hitokotoByHour[h] = [];
      hitokotoByHour[h].push(r);
    } else {
      if (!byHour[h]) byHour[h] = [];
      byHour[h].push(r);
    }
  }

  let html = '';
  for (let h = 0; h < 24; h++) {
    const hrs        = byHour[h] || [];
    const hitokotos  = hitokotoByHour[h] || [];
    const hasNormal  = hrs.length > 0;
    const isOpen     = state.expanded.has(h) && hasNormal;

    const iconsHtml = hrs.slice(0, 7).map(r => {
      const c = CAT[r.category] || CATS[0];
      return `<div class="rec-icon" style="background:${c.bg}">${c.emoji}</div>`;
    }).join('');

    const chevron = hasNormal
      ? `<button class="expand-chevron" onclick="toggleHour(${h})">${isOpen ? '∧' : '∨'}</button>`
      : '';

    const detailRows = hrs.map(r => {
      const c = CAT[r.category] || CATS[0];
      const min = r.time.split(':')[1] || '00';
      let txt = c.label;
      if (r.value) {
        if (WITH_ML.has(r.category)) txt += ` ${r.value}ml`;
        else if (r.category === 'weight') txt += ` ${r.value}g`;
        else if (r.category === 'temp') txt += ` ${r.value}℃`;
        else if (r.category === 'height') txt += ` ${r.value}cm`;
        else txt += ` ${r.value}`;
      }
      if (r.note) txt += r.value ? ` (${r.note})` : ` ${r.note}`;
      return `
        <div class="detail-row" onclick="openEdit('${escHtml(r.id)}')">
          <span class="detail-time">:${min}</span>
          <div class="detail-icon" style="background:${c.bg}">${c.emoji}</div>
          <span class="detail-text">${escHtml(txt)}</span>
          <span class="detail-arrow">›</span>
        </div>`;
    }).join('');

    // ひとことカード（常時表示・展開不要）
    const hitokotoCards = hitokotos.map(r => `
      <div class="hitokoto-card" onclick="openHitokoto('${escHtml(r.id)}')">
        <div class="hitokoto-card-icon">✏️</div>
        <span class="hitokoto-card-text">${escHtml(r.note)}</span>
      </div>`).join('');

    html += `
      <div class="hour-row" id="hr-${h}">
        <div class="hour-header${hasNormal ? ' clickable' : ''}" ${hasNormal ? `onclick="toggleHour(${h})"` : ''}>
          <span class="hour-label">${h}</span>
          <div class="hour-icons">${iconsHtml}</div>
          ${chevron}
        </div>
        <div class="hour-details${isOpen ? ' open' : ''}" id="hd-${h}">${detailRows}</div>
        ${hitokotoCards}
      </div>`;
  }
  el.innerHTML = html;
}

function renderCatGrid() {
  const el = document.getElementById('catGrid');
  // 日記・メモ以外を全部表示、横スクロール
  const visible = CATS.filter(c => c.id !== 'diary' && c.id !== 'memo');
  el.innerHTML = visible.map(c => `
    <button class="cat-btn" onclick="openInput('${c.id}')">
      <div class="cat-icon" style="background:${c.bg}">${c.emoji}</div>
      <span class="cat-label">${c.label}</span>
    </button>`).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== 時間トグル =====
function toggleHour(h) {
  if (state.expanded.has(h)) state.expanded.delete(h);
  else state.expanded.add(h);

  const detail = document.getElementById(`hd-${h}`);
  const chevron = document.querySelector(`#hr-${h} .expand-chevron`);
  if (detail) detail.classList.toggle('open', state.expanded.has(h));
  if (chevron) chevron.textContent = state.expanded.has(h) ? '∧' : '∨';
}

// ===== 日付切替 =====
function changeDate(delta) {
  state.date = addDays(state.date, delta);
  state.expanded = new Set();
  renderAll();
  syncFetch(state.date);
}

function openCalendar() {
  const inp = document.getElementById('hiddenDateInput');
  inp.value = state.date;
  inp.style.pointerEvents = 'auto';
  inp.focus();
  inp.click();
  inp.onchange = () => {
    if (inp.value) {
      state.date = inp.value;
      state.expanded = new Set();
      renderAll();
      syncFetch(state.date);
    }
    inp.style.pointerEvents = 'none';
  };
}

// ===== 入力モーダル =====
function openInput(catId) {
  modal.catId = catId;
  modal.step = 0;
  modal.time = null;
  document.getElementById('inputModal').classList.remove('hidden');

  if (WITH_NOTE.has(catId) && !WITH_ML.has(catId) && catId !== 'food' && catId !== 'medicine') {
    renderStepNote();
  } else {
    renderStepTime();
  }
  // WITH_TEMP は renderStepTime → goStepValue で体温ピッカーへ
}

function closeModal() {
  document.getElementById('inputModal').classList.add('hidden');
}

// --- ステップ1: 時刻選択 ---
function renderStepTime() {
  const c = CAT[modal.catId];
  const now = new Date();
  const defH = now.getHours();
  const defM = Math.floor(now.getMinutes() / 5);
  const isTimeOnly = TIME_ONLY.has(modal.catId);

  const badge = isTimeOnly ? '' : `
    <span class="modal-badge" style="background:${c.bg};color:${c.color}">時刻</span>`;

  const steps = (isTimeOnly || WITH_NOTE.has(modal.catId)) ? '' : `
    <div class="step-dots"><div class="step-dot on"></div><div class="step-dot"></div></div>`;

  document.getElementById('modalSheet').innerHTML = `
    <div class="modal-head">
      <div class="modal-big-icon" style="background:${c.bg}">${c.emoji}</div>
      <span class="modal-title-text" style="color:${c.color}">${c.label}</span>
      ${badge}
    </div>
    ${steps}
    <div class="picker-container">
      <div class="picker-col">
        <div class="picker-col-label">時</div>
        <div class="picker" id="pHour"></div>
      </div>
      <div class="picker-colon">:</div>
      <div class="picker-col">
        <div class="picker-col-label">分</div>
        <div class="picker" id="pMin"></div>
      </div>
    </div>
    ${isTimeOnly
      ? `<button class="btn-primary" onclick="submitRecord()">きろくする</button>`
      : (modal.catId === 'food' || modal.catId === 'medicine')
        ? `<button class="btn-primary" onclick="goStepNote()">メモへ ＞</button>`
        : modal.catId === 'temp'
          ? `<button class="btn-primary" onclick="goStepValue()">体温を入力へ ＞</button>`
          : modal.catId === 'height'
            ? `<button class="btn-primary" onclick="goStepValue()">身長を入力へ ＞</button>`
            : `<button class="btn-primary" onclick="goStepValue()">量のきろくへ ＞</button>`
    }
    <button class="btn-cancel" onclick="closeModal()">キャンセル</button>`;

  const hours = Array.from({length:24}, (_,i) => ({ label:`${i}時`, val:`${i}` }));
  const mins  = Array.from({length:12}, (_,i) => ({ label:`${pad(i*5)}分`, val:`${i*5}` }));
  setupPicker('pHour', hours, defH);
  setupPicker('pMin',  mins,  defM);
}

// --- ステップ2a: 量選択 ---
function renderStepValue() {
  const c = CAT[modal.catId];
  let items, defIdx, unit;

  if (modal.catId === 'weight') {
    items = Array.from({length:80}, (_,i) => { const g = 1000+i*50; return {label:`${g}g`, val:`${g}`}; });
    defIdx = 20; unit = 'g';
  } else if (modal.catId === 'height') {
    items = Array.from({length:181}, (_,i) => { const cm = 30 + i * 0.5; return {label:`${cm.toFixed(1)}cm`, val:`${cm.toFixed(1)}`}; });
    defIdx = 40; unit = 'cm'; // default 50cm
  } else if (modal.catId === 'temp') {
    // 体温: 35.0〜40.9℃、0.1刻み
    items = Array.from({length:60}, (_,i) => {
      const v = (350 + i) / 10;
      return {label:`${v.toFixed(1)}℃`, val:`${v.toFixed(1)}`};
    });
    defIdx = 21; unit = '℃'; // 37.1℃
  } else {
    // ml: 10〜300ml、10刻み
    items = Array.from({length:30}, (_,i) => { const ml=(i+1)*10; return {label:`${ml}ml`, val:`${ml}`}; });
    defIdx = 7; unit = 'ml';
  }

  document.getElementById('modalSheet').innerHTML = `
    <div class="modal-head">
      <div class="modal-big-icon" style="background:${c.bg}">${c.emoji}</div>
      <span class="modal-title-text" style="color:${c.color}">${c.label}</span>
      <span class="modal-badge" style="background:${c.bg};color:${c.color}">${unit}</span>
    </div>
    <div class="step-dots"><div class="step-dot"></div><div class="step-dot on"></div></div>
    <div class="picker-container">
      <div class="picker-col">
        <div class="picker" id="pValue" style="width:130px"></div>
      </div>
    </div>
    <button class="btn-primary" onclick="submitRecord()">きろくする</button>
    <button class="btn-cancel" onclick="closeModal()">キャンセル</button>`;

  setupPicker('pValue', items, defIdx);
}

// --- ステップ2b: テキストメモ ---
function renderStepNote() {
  const c = CAT[modal.catId];
  const placeholder = {
    diary: '今日の出来事・気づきを書いてね',
    memo: 'メモを入力',
    medicine: '薬の名前・量など',
    food: '食べた内容など',
  }[modal.catId] || 'メモを入力';

  document.getElementById('modalSheet').innerHTML = `
    <div class="modal-head">
      <div class="modal-big-icon" style="background:${c.bg}">${c.emoji}</div>
      <span class="modal-title-text" style="color:${c.color}">${c.label}</span>
    </div>
    <textarea class="note-textarea" id="noteInput" placeholder="${placeholder}"></textarea>
    <button class="btn-primary" onclick="submitRecord()">きろくする</button>
    <button class="btn-cancel" onclick="closeModal()">キャンセル</button>`;

  setTimeout(() => document.getElementById('noteInput')?.focus(), 80);
}

function goStepValue() {
  const h = pickVal('pHour'), m = pickVal('pMin');
  modal.time = `${pad(parseInt(h))}:${pad(parseInt(m))}`;
  modal.step = 1;
  renderStepValue();
}

function goStepNote() {
  const h = pickVal('pHour'), m = pickVal('pMin');
  modal.time = `${pad(parseInt(h))}:${pad(parseInt(m))}`;
  modal.step = 1;
  renderStepNote();
}

function submitRecord() {
  const catId = modal.catId;
  const isNoteOnly = WITH_NOTE.has(catId) && !WITH_ML.has(catId) && catId !== 'food';

  let time, value = '', note = '';

  if (isNoteOnly) {
    // 日記・メモ・薬(ステップ0から直接)
    time = nowTime();
    note = document.getElementById('noteInput')?.value?.trim() || '';
  } else if (modal.step === 0) {
    // 時刻のみカテゴリ
    const h = pickVal('pHour'), m = pickVal('pMin');
    time = `${pad(parseInt(h))}:${pad(parseInt(m))}`;
  } else if (modal.step === 1 && document.getElementById('noteInput')) {
    // food: 時刻→メモ
    time = modal.time;
    note = document.getElementById('noteInput')?.value?.trim() || '';
  } else {
    // 時刻→量
    time = modal.time;
    value = pickVal('pValue');
  }

  const dk = state.date;
  const record = {
    id: `${dk}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    date: dk,
    time,
    category: catId,
    value,
    note,
  };

  closeModal();
  addRecord(record);

  // 記録した時間を展開
  const hour = parseInt(time.split(':')[0], 10);
  state.expanded.add(hour);
  setTimeout(() => {
    const hd = document.getElementById(`hd-${hour}`);
    if (hd) hd.classList.add('open');
    const chev = document.querySelector(`#hr-${hour} .expand-chevron`);
    if (chev) chev.textContent = '∧';
    // スクロール
    const row = document.getElementById(`hr-${hour}`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 50);
}

// ===== ひとこと =====
let editingHitokotoId = null; // 編集中のID（nullなら新規）

function openHitokoto(existingId) {
  editingHitokotoId = existingId || null;
  document.getElementById('hitokotoModal').classList.remove('hidden');
  renderHitokotoModal();
}

function closeHitokoto() {
  document.getElementById('hitokotoModal').classList.add('hidden');
  editingHitokotoId = null;
}

function renderHitokotoModal() {
  const records = state.records[state.date] || [];
  const existing = editingHitokotoId
    ? records.find(r => r.id === editingHitokotoId)
    : null;
  const currentText = existing ? (existing.note || '') : '';

  const d = parseDateStr(state.date);
  const weekdays = ['日','月','火','水','木','金','土'];
  const dateText = `${formatJP(state.date)}（${weekdays[d.getDay()]}）`;

  const deleteRow = existing ? `
    <div class="hitokoto-delete-row">
      <button class="hitokoto-delete-btn" onclick="deleteHitokoto('${existing.id}')">このコメントを削除</button>
    </div>` : '';

  document.getElementById('hitokotoSheet').innerHTML = `
    <div class="hitokoto-header">
      <div class="hitokoto-modal-icon">✏️</div>
      <span class="modal-title-text">ひとことコメント</span>
    </div>
    <div class="hitokoto-label-row">
      <span class="hitokoto-label">🐣 コメント</span>
      <span class="hitokoto-count" id="hitokotoCount">${currentText.length}/300</span>
    </div>
    <textarea class="hitokoto-textarea" id="hitokotoText"
      placeholder="コメントが入った時"
      maxlength="300"
      oninput="updateHitokotoCount()"
    >${escHtml(currentText)}</textarea>
    <div class="hitokoto-date-row">
      <span class="hitokoto-date-label">📅 きろくする日</span>
      <span class="hitokoto-date-value">${dateText}</span>
    </div>
    ${deleteRow}
    <button class="btn-primary" onclick="submitHitokoto()">きろくする</button>
    <button class="btn-cancel" onclick="closeHitokoto()">キャンセル</button>`;

  setTimeout(() => document.getElementById('hitokotoText')?.focus(), 80);
}

function updateHitokotoCount() {
  const ta = document.getElementById('hitokotoText');
  const counter = document.getElementById('hitokotoCount');
  if (ta && counter) counter.textContent = `${ta.value.length}/300`;
}

function submitHitokoto() {
  const text = document.getElementById('hitokotoText')?.value?.trim() || '';
  if (!text) { closeHitokoto(); return; }

  if (editingHitokotoId) {
    // 既存レコードのnoteを更新
    const dk = state.date;
    const records = state.records[dk] || [];
    const rec = records.find(r => r.id === editingHitokotoId);
    if (rec) {
      rec.note = text;
      saveCache();
      renderTimeline();
      renderSummary();
      syncSave(rec);
    }
  } else {
    const record = {
      id: `${state.date}-hitokoto-${Date.now()}`,
      date: state.date,
      time: nowTime(),
      category: 'hitokoto',
      value: '',
      note: text,
    };
    addRecord(record);
  }
  closeHitokoto();
  showToast('✓ ひとこと保存しました');
}

function deleteHitokoto(id) {
  if (confirm('このコメントを削除しますか？')) {
    removeRecord(id);
    closeHitokoto();
  }
}

// ===== 編集 =====
let editingRecordId = null;

function openEdit(recordId) {
  const record = (state.records[state.date] || []).find(r => r.id === recordId);
  if (!record) return;
  editingRecordId = recordId;
  document.getElementById('inputModal').classList.remove('hidden');
  renderEditModal(record);
}

function renderEditModal(record) {
  const c = CAT[record.category] || CATS[0];
  const [hStr, mStr] = record.time.split(':');
  const defH = parseInt(hStr, 10) || 0;
  const defM = Math.floor((parseInt(mStr, 10) || 0) / 5);

  // 値入力エリア
  let valueSection = '';
  let editItems = null, editDefIdx = 0;

  if (WITH_ML.has(record.category)) {
    editItems = Array.from({length:30}, (_,i) => { const ml=(i+1)*10; return {label:`${ml}ml`, val:`${ml}`}; });
    editDefIdx = Math.max(0, Math.round(parseInt(record.value||'80')/10) - 1);
    valueSection = `<div class="picker-container" style="margin-top:8px">
      <div class="picker-col">
        <div class="picker-col-label">ml</div>
        <div class="picker" id="pEditValue" style="width:130px"></div>
      </div></div>`;
  } else if (record.category === 'weight') {
    editItems = Array.from({length:80}, (_,i) => { const g=1000+i*50; return {label:`${g}g`, val:`${g}`}; });
    editDefIdx = Math.max(0, Math.round((parseInt(record.value||'2000')-1000)/50));
    valueSection = `<div class="picker-container" style="margin-top:8px">
      <div class="picker-col">
        <div class="picker-col-label">g</div>
        <div class="picker" id="pEditValue" style="width:130px"></div>
      </div></div>`;
  } else if (record.category === 'temp') {
    editItems = Array.from({length:60}, (_,i) => { const v=(350+i)/10; return {label:`${v.toFixed(1)}℃`, val:`${v.toFixed(1)}`}; });
    editDefIdx = Math.max(0, Math.round((parseFloat(record.value||'37.0')*10)-350));
    valueSection = `<div class="picker-container" style="margin-top:8px">
      <div class="picker-col">
        <div class="picker-col-label">℃</div>
        <div class="picker" id="pEditValue" style="width:130px"></div>
      </div></div>`;
  } else if (record.category === 'height') {
    editItems = Array.from({length:181}, (_,i) => { const cm = 30+i*0.5; return {label:`${cm.toFixed(1)}cm`, val:`${cm.toFixed(1)}`}; });
    editDefIdx = Math.max(0, Math.round((parseFloat(record.value||'50') - 30) / 0.5));
    valueSection = `<div class="picker-container" style="margin-top:8px">
      <div class="picker-col">
        <div class="picker-col-label">cm</div>
        <div class="picker" id="pEditValue" style="width:130px"></div>
      </div></div>`;
  } else if (record.note !== undefined && record.note !== '') {
    valueSection = `<textarea class="note-textarea" id="editNoteInput">${escHtml(record.note)}</textarea>`;
  }

  document.getElementById('modalSheet').innerHTML = `
    <div class="modal-head">
      <div class="modal-big-icon" style="background:${c.bg}">${c.emoji}</div>
      <span class="modal-title-text" style="color:${c.color}">${c.label}</span>
      <span class="modal-badge" style="background:${c.bg};color:${c.color}">編集</span>
    </div>
    <div class="picker-container">
      <div class="picker-col">
        <div class="picker-col-label">時</div>
        <div class="picker" id="pEditHour"></div>
      </div>
      <div class="picker-colon">:</div>
      <div class="picker-col">
        <div class="picker-col-label">分</div>
        <div class="picker" id="pEditMin"></div>
      </div>
    </div>
    ${valueSection}
    <button class="btn-primary" onclick="submitEdit()">保存する</button>
    <button class="btn-cancel btn-delete" onclick="deleteFromEdit()">このきろくを削除</button>
    <button class="btn-cancel" onclick="closeModal()">キャンセル</button>`;

  const hours = Array.from({length:24}, (_,i) => ({label:`${i}時`, val:`${i}`}));
  const mins  = Array.from({length:12}, (_,i) => ({label:`${pad(i*5)}分`, val:`${i*5}`}));
  setupPicker('pEditHour', hours, defH);
  setupPicker('pEditMin',  mins,  defM);
  if (editItems) setupPicker('pEditValue', editItems, editDefIdx);
}

function submitEdit() {
  const dk = state.date;
  const record = (state.records[dk] || []).find(r => r.id === editingRecordId);
  if (!record) { closeModal(); return; }

  const h = pickVal('pEditHour'), m = pickVal('pEditMin');
  record.time = `${pad(parseInt(h))}:${pad(parseInt(m))}`;

  if (WITH_ML.has(record.category) || record.category === 'weight' || record.category === 'temp' || record.category === 'height') {
    record.value = pickVal('pEditValue');
  } else {
    const noteEl = document.getElementById('editNoteInput');
    if (noteEl) record.note = noteEl.value.trim();
  }

  state.records[dk].sort((a, b) => a.time.localeCompare(b.time));
  saveCache();
  renderTimeline();
  renderSummary();
  syncDelete(record.id);
  syncSave(record);

  closeModal();
  editingRecordId = null;
  showToast('✓ 更新しました');
}

function deleteFromEdit() {
  if (confirm('この記録を削除しますか？')) {
    removeRecord(editingRecordId);
    closeModal();
    editingRecordId = null;
  }
}

// ===== 削除 =====
function confirmDelete(id) {
  if (confirm('この記録を削除しますか？')) removeRecord(id);
}

// ===== スクロールピッカー =====
function setupPicker(id, items, defIdx) {
  const el = document.getElementById(id);
  if (!el) return;

  let html = '<div class="picker-pad"></div>';
  items.forEach((item, i) => {
    html += `<div class="picker-item" data-idx="${i}" data-val="${escHtml(item.val)}">${escHtml(item.label)}</div>`;
  });
  html += '<div class="picker-pad"></div>';
  el.innerHTML = html;

  // デフォルト位置へスクロール
  requestAnimationFrame(() => {
    el.scrollTop = defIdx * 40;
    updateHighlight(el);
  });

  let scrollTimer;
  el.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const idx = Math.round(el.scrollTop / 40);
      el.scrollTo({ top: idx * 40, behavior: 'smooth' });
      updateHighlight(el);
    }, 80);
  }, { passive: true });
}

function updateHighlight(el) {
  const idx = Math.round(el.scrollTop / 40);
  el.querySelectorAll('.picker-item').forEach((item, i) => {
    item.classList.toggle('sel', i === idx);
  });
}

function pickVal(id) {
  const el = document.getElementById(id);
  if (!el) return '0';
  const idx = Math.round(el.scrollTop / 40);
  const item = el.querySelectorAll('.picker-item')[idx];
  return item ? item.dataset.val : '0';
}

// ===== 設定 =====
function openSettings() {
  document.getElementById('settingsModal').classList.remove('hidden');
  document.getElementById('scriptUrlInput').value = CONFIG.scriptUrl;
}

function closeSettings() {
  document.getElementById('settingsModal').classList.add('hidden');
}

function saveSettings() {
  const url = document.getElementById('scriptUrlInput').value.trim();
  localStorage.setItem('scriptUrl', url);
  closeSettings();
  showToast('設定を保存しました');
  if (url) syncFetch(state.date);
}

// ===== トースト =====
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}

// ===== 成長曲線データ（厚労省乳幼児身体発育調査 参考・概算） =====
// [月齢, 体重低(kg), 体重高(kg), 身長低(cm), 身長高(cm)]
const GROWTH_REF = [
  [0,   2.5,  4.2,  46.0, 54.0],
  [1,   3.4,  5.5,  50.0, 57.5],
  [2,   4.2,  7.0,  53.5, 61.5],
  [3,   5.0,  8.0,  57.0, 64.5],
  [4,   5.6,  8.7,  59.5, 67.5],
  [5,   6.1,  9.3,  61.5, 70.0],
  [6,   6.4,  9.8,  63.0, 71.5],
  [7,   6.8, 10.3,  64.5, 73.0],
  [8,   7.0, 10.6,  66.0, 74.5],
  [9,   7.3, 10.9,  67.5, 76.0],
  [10,  7.5, 11.2,  68.5, 77.5],
  [11,  7.8, 11.5,  70.0, 79.0],
  [12,  8.0, 11.8,  71.0, 80.0],
  [15,  8.6, 12.5,  74.0, 83.5],
  [18,  9.1, 13.2,  77.0, 87.0],
  [21,  9.6, 13.9,  79.5, 90.0],
  [24, 10.1, 14.6,  81.5, 93.0],
  [27, 10.5, 15.3,  84.0, 96.0],
  [30, 11.0, 16.1,  86.5, 99.0],
  [33, 11.5, 16.9,  89.0,102.0],
  [36, 12.0, 17.7,  91.5,105.0],
  [40, 12.6, 18.8,  94.5,108.5],
  [44, 13.2, 19.9,  97.0,112.0],
  [48, 13.8, 21.0,  99.5,115.5],
  [54, 14.6, 22.5, 103.0,120.0],
  [60, 15.5, 24.2, 106.5,124.5],
  [66, 16.4, 26.0, 110.0,129.0],
  [72, 17.3, 28.0, 113.5,133.0],
  [78, 18.3, 30.2, 117.0,137.0],
  [84, 19.3, 32.6, 120.0,141.0],
  [90, 20.5, 35.2, 123.0,145.0],
  [96, 21.8, 38.5, 126.0,148.5],
  [108, 24.5, 44.5, 131.5,155.5],
  [120, 27.5, 51.0, 137.0,162.0],
  [132, 31.0, 58.5, 142.0,167.5],
  [144, 35.5, 66.5, 146.5,171.5],
  [156, 40.0, 73.0, 150.0,173.5],
  [168, 44.0, 76.0, 152.0,175.0],
  [180, 46.5, 77.0, 152.5,175.5],
  [216, 48.0, 78.5, 153.5,176.0],
];

// ===== 月齢計算（小数対応） =====
function monthsOld(dateStr) {
  const d = parseDateStr(dateStr);
  const b = CONFIG.birthDate;
  return Math.max(0, (d - b) / (1000 * 60 * 60 * 24 * 30.44));
}

// ===== カレンダーモーダル =====
const calState = { year: new Date().getFullYear(), month: new Date().getMonth() };

function openCalendarView() {
  const cur = parseDateStr(state.date);
  calState.year = cur.getFullYear();
  calState.month = cur.getMonth();
  document.getElementById('calendarModal').classList.remove('hidden');
  renderCalendarView();
}

function closeCalendarView() {
  document.getElementById('calendarModal').classList.add('hidden');
}

function renderCalendarView() {
  const { year, month } = calState;
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = today();
  const weekDays = ['日','月','火','水','木','金','土'];

  let html = `
    <div class="cal-nav-row">
      <button class="cal-nav-btn" onclick="calNavMonth(-1)">＜</button>
      <span class="cal-month-label">${year}年${month+1}月</span>
      <button class="cal-nav-btn" onclick="calNavMonth(1)">＞</button>
    </div>
    <div class="cal-dow-row">
      ${weekDays.map((d,i) => `<div class="cal-dow${i===0?' sun':i===6?' sat':''}">${d}</div>`).join('')}
    </div>
    <div class="cal-grid">`;

  for (let i = 0; i < firstDow; i++) html += `<div class="cal-cell empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad(month+1)}-${pad(d)}`;
    const records = state.records[dateStr] || [];
    const hasData = records.some(r => r.category !== 'hitokoto');
    const isToday = dateStr === todayStr;
    const isSel   = dateStr === state.date;
    const dow = (firstDow + d - 1) % 7;
    html += `
      <div class="cal-cell${isToday?' today':''}${isSel?' selected':''}" onclick="calSelectDay('${dateStr}')">
        <span class="cal-day-num${dow===0?' sun':dow===6?' sat':''}">${d}</span>
        ${hasData ? '<div class="cal-dot"></div>' : ''}
      </div>`;
  }
  html += '</div>';
  document.getElementById('calendarContent').innerHTML = html;
}

function calNavMonth(delta) {
  calState.month += delta;
  if (calState.month > 11) { calState.month = 0; calState.year++; }
  if (calState.month < 0)  { calState.month = 11; calState.year--; }
  renderCalendarView();
}

function calSelectDay(dateStr) {
  state.date = dateStr;
  state.expanded = new Set();
  closeCalendarView();
  renderAll();
  syncFetch(state.date);
}

// ===== 成長グラフ =====
const graphState = { ageTab: 1 };

function openGraph() {
  document.getElementById('graphModal').classList.remove('hidden');
  requestAnimationFrame(() => {
    resizeGraphCanvas();
    renderGraph();
  });
}

function resizeGraphCanvas() {
  const canvas = document.getElementById('growthCanvas');
  const container = document.getElementById('graphCanvasWrap');
  canvas.width  = container.clientWidth  || 360;
  canvas.height = container.clientHeight || Math.round((container.clientWidth || 360) * 1.1);
}

function closeGraph() {
  document.getElementById('graphModal').classList.add('hidden');
}

function setGraphAge(age) {
  graphState.ageTab = age;
  document.querySelectorAll('.graph-age-tab').forEach(t => {
    t.classList.toggle('active', parseInt(t.dataset.age) === age);
  });
  resizeGraphCanvas();
  renderGraph();
}

function renderGraph() {
  // 体重・身長データを収集
  const wPoints = [], hPoints = [];
  for (const [dateStr, records] of Object.entries(state.records)) {
    const mo = monthsOld(dateStr);
    for (const r of records) {
      if (r.category === 'weight' && r.value) {
        const kg = parseFloat(r.value) / 1000;
        if (!isNaN(kg) && kg > 0) wPoints.push({ months: mo, value: kg });
      }
      if (r.category === 'height' && r.value) {
        const cm = parseFloat(r.value);
        if (!isNaN(cm) && cm > 0) hPoints.push({ months: mo, value: cm });
      }
    }
  }
  drawGrowthGraph(wPoints, hPoints);
}

function drawGrowthGraph(wPoints, hPoints) {
  const canvas = document.getElementById('growthCanvas');
  if (!canvas) return;

  const maxAgeYr  = graphState.ageTab;
  const maxMonths = maxAgeYr * 12;
  const isYearAxis = maxAgeYr >= 8;
  const refData = GROWTH_REF.filter(d => d[0] <= maxMonths);

  const W = canvas.width, H = canvas.height;
  const PL = 44, PR = 42, PT = 18, PB = 34;
  const PW = W - PL - PR, PH = H - PT - PB;

  // Y-axis範囲
  const wMin = 0;
  const wMax = Math.ceil(Math.max(...refData.map(d => d[2])) / 5) * 5 + 2;
  const hMin = Math.floor(Math.min(...refData.map(d => d[3])) / 10) * 10;
  const hMax = Math.ceil(Math.max(...refData.map(d => d[4])) / 10) * 10 + 5;

  const xOf  = m  => PL + (m  / maxMonths) * PW;
  const yOfW = kg => PT + PH * (1 - (kg - wMin) / (wMax - wMin));
  const yOfH = cm => PT + PH * (1 - (cm - hMin) / (hMax - hMin));

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // 背景
  ctx.fillStyle = '#141428';
  ctx.fillRect(0, 0, W, H);

  // グリッド線
  const wStep = wMax <= 15 ? 2 : wMax <= 35 ? 5 : 10;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 4]);

  for (let w = 0; w <= wMax; w += wStep) {
    const y = yOfW(w);
    if (y < PT - 1 || y > PT + PH + 1) continue;
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#81C784'; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(w, PL - 3, y + 3);
    ctx.setLineDash([3, 4]);
  }

  const xStepM = isYearAxis ? (maxAgeYr <= 12 ? 12 : 24) : (maxAgeYr === 1 ? 1 : maxAgeYr === 2 ? 2 : 4);
  for (let m = 0; m <= maxMonths; m += xStepM) {
    const x = xOf(m);
    ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + PH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(isYearAxis ? `${m/12}` : `${m}`, x, PT + PH + 14);
    ctx.setLineDash([3, 4]);
  }
  ctx.setLineDash([]);

  // 右軸ラベル（身長）
  const hStep = (hMax - hMin) <= 60 ? 5 : 10;
  for (let h = Math.ceil(hMin/hStep)*hStep; h <= hMax; h += hStep) {
    const y = yOfH(h);
    if (y < PT - 1 || y > PT + PH + 1) continue;
    ctx.fillStyle = '#7EC8D4'; ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(h, W - PR + 3, y + 3);
  }

  // 軸線
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PL, PT); ctx.lineTo(PL, PT+PH); ctx.lineTo(W-PR, PT+PH);
  ctx.stroke();

  // 身長参考帯（青）
  ctx.beginPath();
  ctx.moveTo(xOf(refData[0][0]), yOfH(refData[0][3]));
  for (const d of refData) ctx.lineTo(xOf(d[0]), yOfH(d[3]));
  for (const d of [...refData].reverse()) ctx.lineTo(xOf(d[0]), yOfH(d[4]));
  ctx.closePath();
  ctx.fillStyle = 'rgba(70,130,220,0.38)';
  ctx.fill();

  // 体重参考帯（緑）
  ctx.beginPath();
  ctx.moveTo(xOf(refData[0][0]), yOfW(refData[0][1]));
  for (const d of refData) ctx.lineTo(xOf(d[0]), yOfW(d[1]));
  for (const d of [...refData].reverse()) ctx.lineTo(xOf(d[0]), yOfW(d[2]));
  ctx.closePath();
  ctx.fillStyle = 'rgba(50,150,70,0.38)';
  ctx.fill();

  // ユーザー体重
  const wSorted = wPoints.filter(p => p.months >= 0 && p.months <= maxMonths)
    .sort((a,b) => a.months - b.months);
  if (wSorted.length > 0) {
    ctx.strokeStyle = '#81C784'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xOf(wSorted[0].months), yOfW(wSorted[0].value));
    for (const p of wSorted.slice(1)) ctx.lineTo(xOf(p.months), yOfW(p.value));
    ctx.stroke();
    for (const p of wSorted) {
      ctx.fillStyle = '#81C784';
      ctx.beginPath(); ctx.arc(xOf(p.months), yOfW(p.value), 4, 0, Math.PI*2); ctx.fill();
    }
  }

  // ユーザー身長
  const hSorted = hPoints.filter(p => p.months >= 0 && p.months <= maxMonths)
    .sort((a,b) => a.months - b.months);
  if (hSorted.length > 0) {
    ctx.strokeStyle = '#7EC8D4'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xOf(hSorted[0].months), yOfH(hSorted[0].value));
    for (const p of hSorted.slice(1)) ctx.lineTo(xOf(p.months), yOfH(p.value));
    ctx.stroke();
    for (const p of hSorted) {
      ctx.fillStyle = '#7EC8D4';
      ctx.beginPath(); ctx.arc(xOf(p.months), yOfH(p.value), 4, 0, Math.PI*2); ctx.fill();
    }
  }

  // 単位ラベル
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(isYearAxis ? '(歳)' : '(か月)', W/2, H - 4);
  ctx.fillStyle = '#81C784'; ctx.textAlign = 'left';
  ctx.fillText('(kg)', 2, PT + 12);
  ctx.fillStyle = '#7EC8D4'; ctx.textAlign = 'right';
  ctx.fillText('(cm)', W - 2, PT + 12);
}

// ===== 初期化 =====
function init() {
  loadCache();
  state.date = today();

  // 同期バッジ要素を追加
  const badge = document.createElement('div');
  badge.id = 'syncBadge';
  badge.className = 'sync-badge';
  badge.style.display = 'none';
  document.body.appendChild(badge);

  renderAll();

  // 現在時刻付近にスクロール
  const h = Math.max(0, new Date().getHours() - 2);
  setTimeout(() => {
    const row = document.getElementById(`hr-${h}`);
    if (row) row.scrollIntoView({ block: 'start' });
  }, 150);

  // Sheetsから取得
  if (CONFIG.scriptUrl) syncFetch(state.date);

  // アプリがフォアグラウンドに戻ったとき自動同期
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && CONFIG.scriptUrl) {
      syncFetch(state.date);
    }
  });

  // PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
