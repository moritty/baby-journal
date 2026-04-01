/**
 * baby-journal Google Apps Script
 *
 * ■ 設定手順
 * 1. スプレッドシートを開く
 * 2. メニュー「拡張機能」→「Apps Script」
 * 3. このファイルの内容を貼り付けて保存（Ctrl+S）
 * 4. 「デプロイ」→「新しいデプロイ」
 *    - 種類: ウェブアプリ
 *    - 実行ユーザー: 自分
 *    - アクセスできるユーザー: 全員
 * 5. 「デプロイ」→ URLをコピー
 * 6. アプリの設定画面にそのURLを貼り付ける
 */

const SHEET_NAME = 'Records';
const HEADERS = ['ID', 'Date', 'Time', 'Category', 'Value', 'Note', 'CreatedAt'];

// ===== GET: 全操作をGETで処理（CORSが安定する） =====
function doGet(e) {
  try {
    const p = e.parameter || {};
    const action = p.action || '';

    if (action === 'save' && p.data) {
      const record = JSON.parse(p.data);
      return handleSave(record);
    }

    if (action === 'delete' && p.id) {
      return handleDelete(p.id);
    }

    if (action === 'get' && p.date) {
      return handleGetByDate(p.date);
    }

    // 後方互換: action なしで date のみの場合も対応
    if (p.date) {
      return handleGetByDate(p.date);
    }

    return json({ error: 'invalid request' });
  } catch(err) {
    return json({ error: err.message });
  }
}

// ===== POST: 後方互換で残す =====
function doPost(e) {
  try {
    const record = JSON.parse(e.postData.contents);
    return handleSave(record);
  } catch(err) {
    return json({ error: err.message });
  }
}

// ===== 日付でレコード取得 =====
function handleGetByDate(date) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const records = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    // SheetsがDate型に変換する場合があるので文字列に統一して比較
    const rowDate = toDateStr(row[1]);
    if (rowDate === date) {
      records.push({
        id:       String(row[0]),
        date:     rowDate,
        time:     toTimeStr(row[2]),
        category: String(row[3]),
        value:    row[4] !== '' ? String(row[4]) : '',
        note:     String(row[5] || ''),
      });
    }
  }

  return json({ records });
}

// ===== Date型 → YYYY-MM-DD 文字列変換 =====
function toDateStr(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val);
}

// ===== 時刻型 → HH:MM 文字列変換 =====
function toTimeStr(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
  }
  // 文字列の場合もゼロ埋めで統一（例: "6:30" → "06:30"）
  const str = String(val);
  const parts = str.split(':');
  if (parts.length >= 2) {
    return parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0');
  }
  return str;
}

// ===== レコード保存 =====
function handleSave(record) {
  const sheet = getSheet();
  sheet.appendRow([
    record.id       || '',
    record.date     || '',
    record.time     || '',
    record.category || '',
    record.value    !== undefined ? record.value : '',
    record.note     || '',
    new Date().toISOString(),
  ]);
  return json({ success: true });
}

// ===== レコード削除 =====
function handleDelete(id) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();

  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }

  return json({ success: true });
}

// ===== シート取得（なければ作成） =====
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setValues([HEADERS]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#FCE4EC');
    sheet.setFrozenRows(1);
    // 列幅調整
    sheet.setColumnWidth(1, 200); // ID
    sheet.setColumnWidth(2, 100); // Date
    sheet.setColumnWidth(3, 60);  // Time
    sheet.setColumnWidth(4, 80);  // Category
    sheet.setColumnWidth(5, 60);  // Value
    sheet.setColumnWidth(6, 200); // Note
  }

  return sheet;
}

// ===== JSON レスポンス =====
function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
