'use strict';

// ===== 設定 =====
const CONFIG = {
  babyName: 'Kotone',
  birthDate: new Date(2026, 1, 9), // 2026-02-09 (monthは0始まり)
  get scriptUrl() { return localStorage.getItem('scriptUrl') || ''; },
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
  { id: 'diary',    label: '日記',     emoji: '📖', color: '#9FA8DA', bg: '#E8EAF6' },
  { id: 'memo',     label: 'メモ',     emoji: '📝', color: '#80CBC4', bg: '#E0F2F1' },
  { id: 'hitokoto', label: 'ひとこと', emoji: '✏️',  color: '#999',    bg: '#EEEEEE' },
];

const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));

// 入力方式分類
const TIME_ONLY = new Set(['poop', 'pee', 'sleep', 'wake', 'bath']);
const WITH_ML   = new Set(['breast', 'milk', 'pump']);
const WITH_NOTE = new Set(['food', 'diary', 'memo', 'medicine']);
const WITH_TEMP = new Set(['temp']);

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
    const res = await fetch(`${CONFIG.scriptUrl}?date=${dateStr}`);
    const data = await res.json();
    // Sheetsにデータがある場合のみローカルを上書き（空データで消えるのを防ぐ）
    if (Array.isArray(data.records) && data.records.length > 0) {
      state.records[dateStr] = data.records;
      saveCache();
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
  if (!CONFIG.scriptUrl) {
    showToast('💾 ローカルに保存（URL未設定）');
    return;
  }
  setSyncing(true);
  try {
    // no-cors: Apps ScriptへのPOSTはCORSプリフライトを回避
    await fetch(CONFIG.scriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(record),
    });
    showToast('✓ きろくしました');
  } catch(e) {
    showToast('💾 ローカルに保存');
  } finally {
    setSyncing(false);
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

  if (WITH_ML.has(record.category) || record.category === 'weight' || record.category === 'temp') {
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
