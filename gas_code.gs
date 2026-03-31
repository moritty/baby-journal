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

// ===== GET: データ取得 / 削除 =====
function doGet(e) {
  try {
    const p = e.parameter || {};

    if (p.action === 'delete' && p.id) {
      return handleDelete(p.id);
    }

    if (p.date) {
      return handleGetByDate(p.date);
    }

    return json({ error: 'invalid request' });
  } catch(err) {
    return json({ error: err.message });
  }
}

// ===== POST: データ保存 =====
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
    if (String(row[1]) === date) {
      records.push({
        id:       String(row[0]),
        date:     String(row[1]),
        time:     String(row[2]),
        category: String(row[3]),
        value:    row[4] !== '' ? row[4] : '',
        note:     String(row[5] || ''),
      });
    }
  }

  return json({ records });
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
