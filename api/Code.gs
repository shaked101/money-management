/* ════════════════════════════════════════════════════════════
   Code.gs — Backend מלא ל"הכסף שלנו" · Google Apps Script
   מחליף את Make: מסד הנתונים הוא Google Sheets, מנוהל ישירות.

   ▸ פריסה: Deploy → New deployment → Web app
     Execute as: Me · Who has access: Anyone
     את כתובת ה-/exec מדביקים ב-Vercel כ-GOOGLE_SCRIPT_URL.

   ▸ אבטחה (שכבה שנייה, רשות): Project Settings → Script Properties
     → הוסיפו API_KEY עם ערך סודי, והגדירו ב-Vercel משתנה זהה
     בשם GAS_API_KEY. אם ה-Property מוגדר — הסקריפט יאכוף אותו.

   ▸ מבנה הגיליונות (נוצרים אוטומטית בקריאה הראשונה):
     'הוצאות'        A:UID B:תאריך ושעה (DD/MM/YYYY HH:mm) C:מי רשם D:קטגוריה E:סכום F:הערות
     'הכנסות'        (אותו מבנה)
     'תנועות קבועות' A:UID B:סוג C:קטגוריה D:סכום E:תיאור F:מי רשם G:יום בחודש H:נוצר
     'קטגוריות'      A:הוצאה B:אימוג'י C:צבע | D:הכנסה E:אימוג'י F:צבע
   ════════════════════════════════════════════════════════════ */

var TZ = 'Asia/Jerusalem';
var SHEET_EXPENSES  = 'הוצאות';
var SHEET_INCOMES   = 'הכנסות';
var SHEET_RECURRING = 'תנועות קבועות';
var SHEET_CATEGORIES = 'קטגוריות';

var TX_HEADER  = ['UID', 'תאריך ושעה', 'מי רשם', 'קטגוריה', 'סכום', 'הערות'];
var REC_HEADER = ['UID', 'סוג', 'קטגוריה', 'סכום', 'תיאור', 'מי רשם', 'יום בחודש', 'נוצר בתאריך'];
var CAT_HEADER = ['הוצאות', "אימוג'י", 'צבע', 'הכנסות', "אימוג'י", 'צבע'];

var DEFAULT_EXPENSE_CATS = ['סופר', 'אוכל בחוץ', 'רכב ודלק', 'דיור', 'חשבונות', 'ילדים', 'בריאות', 'פנאי', 'ביגוד', 'שונות'];
var DEFAULT_INCOME_CATS  = ['משכורת שקד', 'משכורת אביטל', 'עסק', 'מתנות', 'אחר'];

/* ═══ נקודת הכניסה ═══════════════════════════════════════ */
function doPost(e) {
  var out;
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    requireKey_(p);

    switch (p.action) {
      case 'get':        out = actionGet_(p);        break;
      case 'add':        out = actionAdd_(p);        break;
      case 'delete':     out = actionDelete_(p);     break;
      case 'categories': out = actionCategories_(p); break;
      default:
        out = { ok: false, error: 'Unknown action: ' + String(p.action) };
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  /* GAS לא תומך בכותרות CORS — וזה בסדר גמור: הקריאות מגיעות
     משרת Vercel (Server-to-Server), ו-CORS רלוונטי רק לדפדפנים. */
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* בדיקת חיים נוחה מהדפדפן */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'family-finance-gas', time: nowStamp_() }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ═══ אבטחה ═══════════════════════════════════════════════ */
function requireKey_(p) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!expected) return; /* לא הוגדר מפתח — דילוג (ה-Vercel כבר מאמת X-App-Secret) */
  if (!p || String(p.key || '') !== expected) {
    throw new Error('Unauthorized (bad or missing key)');
  }
}

/* ═══ action: get — שליפה מרוכזת של הכל ═══════════════════
   קריאה אחת לכל גיליון (getDataRange), סינון לפי חודש/שנה,
   מיזוג תנועות קבועות לתוך החודש המבוקש, וצירוף הקטגוריות —
   הכל בתשובה אחת. אפס עלות, אפס Webhooks.                  */
function actionGet_(p) {
  var month = parseInt(p.month, 10);
  var year  = parseInt(p.year, 10);
  if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) {
    return { ok: false, error: 'Invalid month/year' };
  }

  ensureSetup_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rows = [];

  /* הוצאות + הכנסות של החודש */
  rows = rows
    .concat(readTxSheet_(ss.getSheetByName(SHEET_EXPENSES), 'expense', month, year))
    .concat(readTxSheet_(ss.getSheetByName(SHEET_INCOMES),  'income',  month, year));

  /* תנועות קבועות — מוזרקות לכל חודש מבוקש.
     היום בחודש נשמר בעמודה ייעודית (G) מתוך התאריך שנבחר
     בהזנה, עם הצמדה לסוף חודש קצר (31 → 28/29/30).           */
  var recSheet = ss.getSheetByName(SHEET_RECURRING);
  var recVals = recSheet.getDataRange().getValues();
  for (var i = 1; i < recVals.length; i++) {
    var r = recVals[i];
    if (!r[0]) continue;
    var day = parseInt(r[6], 10) || 1;
    var lastDay = new Date(year, month, 0).getDate();
    if (day > lastDay) day = lastDay; /* 31 → 28/29/30 בחודשים קצרים */
    rows.push({
      uid: String(r[0]),
      date: fmtDate_(new Date(year, month - 1, day)),
      type: String(r[1]) === 'income' ? 'income' : 'expense',
      category: String(r[2] || ''),
      amount: Number(r[3]) || 0,
      note: String(r[4] || ''),
      who: String(r[5] || ''),
      recurring: true
    });
  }

  return { ok: true, rows: rows, categories: readCategories_() };
}

function readTxSheet_(sheet, type, month, year) {
  /* מבנה: A:UID B:תאריך ושעה C:מי רשם D:קטגוריה E:סכום F:הערות */
  var vals = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (!r[0]) continue;
    var d = toDate_(r[1]);
    if (!d || d.getMonth() + 1 !== month || d.getFullYear() !== year) continue;
    out.push({
      uid: String(r[0]),
      date: fmtDate_(d),
      type: type,
      who: String(r[2] || ''),
      category: String(r[3] || ''),
      amount: Number(r[4]) || 0,
      note: String(r[5] || '')
    });
  }
  return out;
}

/* ═══ action: add — כתיבת שורה עם חותמת זמן ירושלים ═══════ */
function actionAdd_(p) {
  var type = String(p.type) === 'income' ? 'income' : 'expense';
  var uid = String(p.uid || '').trim() || ('tx_' + new Date().getTime().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36));
  var amount = Number(p.amount);
  var category = String(p.category || '').trim();
  var user = String(p.user || p.who || '').trim();
  var notes = String(p.notes || p.note || '').trim();
  var recurring = p.recurring === true || p.recurring === 'true';

  if (!category) return { ok: false, error: 'Missing category' };
  if (!(amount > 0)) return { ok: false, error: 'Invalid amount' };

  /* תאריך התנועה: מהלקוח, או היום לפי שעון ירושלים */
  var date = String(p.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  }
  /* עמודה B: תאריך התנועה + שעת הרישום בפועל, מאוחדים —
     DD/MM/YYYY HH:mm בשעון ירושלים (בלי שניות, אף פעם לא 00:00) */
  var dateTime = date.slice(8, 10) + '/' + date.slice(5, 7) + '/' + date.slice(0, 4) +
                 ' ' + Utilities.formatDate(new Date(), TZ, 'HH:mm');
  var created = nowStamp_();

  ensureSetup_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  /* נעילה: מונעת שיבוש כשאתה ואביטל (או הווידג'ט) כותבים במקביל */
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (recurring) {
      var dayOfMonth = parseInt(date.slice(8, 10), 10) || 1;
      ss.getSheetByName(SHEET_RECURRING)
        .appendRow([uid, type, category, amount, notes, user, dayOfMonth, created]);
    } else {
      /* הסדר המדויק: A:UID B:תאריך+שעה C:רושם D:קטגוריה E:סכום F:הערות */
      ss.getSheetByName(type === 'income' ? SHEET_INCOMES : SHEET_EXPENSES)
        .appendRow([uid, dateTime, user, category, amount, notes]);
    }
  } finally {
    lock.releaseLock();
  }

  return {
    ok: true,
    row: { uid: uid, date: date, type: type, category: category, amount: amount, note: notes, who: user, recurring: recurring, createdAt: created }
  };
}

/* ═══ action: delete — מחיקה לפי UID, בלי Row Number ═══════
   חיפוש דינמי בעמודת ה-UID (TextFinder על עמודה A בלבד),
   מציאת השורה הפיזית ברגע המחיקה, ומחיקתה. חסין לחלוטין
   למיון/הוספות שקרו מאז שהלקוח טען את הנתונים.              */
function actionDelete_(p) {
  var uid = String(p.uid || '').trim();
  if (!uid) return { ok: false, error: 'Missing uid' };

  ensureSetup_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  /* סדר חיפוש חכם לפי רמז ה-type, עם נפילה לכל הגיליונות */
  var names;
  if (String(p.type) === 'income')      names = [SHEET_INCOMES, SHEET_RECURRING, SHEET_EXPENSES];
  else if (String(p.type) === 'expense') names = [SHEET_EXPENSES, SHEET_RECURRING, SHEET_INCOMES];
  else                                   names = [SHEET_EXPENSES, SHEET_INCOMES, SHEET_RECURRING];

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    for (var i = 0; i < names.length; i++) {
      var sheet = ss.getSheetByName(names[i]);
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) continue;
      var hit = sheet.getRange(2, 1, lastRow - 1, 1)
                     .createTextFinder(uid)
                     .matchEntireCell(true)
                     .findNext();
      if (hit) {
        sheet.deleteRow(hit.getRow());
        return { ok: true, uid: uid, deleted: true, sheet: names[i] };
      }
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: false, error: 'UID not found: ' + uid };
}

/* ═══ action: categories — קריאה / סנכרון מלא / פעולה בודדת ═══ */
function actionCategories_(p) {
  ensureSetup_();

  /* סנכרון מלא: החלפת המבנה כולו (שם + אימוג'י + צבע) */
  if (p.categories && (p.categories.expense || p.categories.income)) {
    var exp = cleanCatList_(p.categories.expense);
    var inc = cleanCatList_(p.categories.income);
    writeCategories_(exp, inc);
    return { ok: true, synced: 'full', categories: { expense: exp, income: inc } };
  }

  /* פעולה בודדת: הוספה/הסרה לפי שם */
  if (p.op === 'add' || p.op === 'remove') {
    var kind = String(p.kind) === 'income' ? 'income' : 'expense';
    var name = String(p.name || '').trim();
    if (!name) return { ok: false, error: 'Missing name' };
    var cats = readCategories_();
    var list = cats[kind];
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].name === name) { idx = i; break; }
    if (p.op === 'add' && idx === -1) list.push({ name: name, emoji: String(p.emoji || ''), color: String(p.color || '') });
    if (p.op === 'remove' && idx !== -1) list.splice(idx, 1);
    writeCategories_(cats.expense, cats.income);
    return { ok: true, synced: 'op', categories: cats };
  }

  /* ללא payload — קריאה בלבד */
  return { ok: true, categories: readCategories_() };
}

function readCategories_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CATEGORIES);
  var vals = sheet.getDataRange().getValues();
  var expense = [], income = [];
  function has(list, name) {
    for (var j = 0; j < list.length; j++) if (list[j].name === name) return true;
    return false;
  }
  for (var i = 1; i < vals.length; i++) {
    var en = String(vals[i][0] || '').trim();
    if (en && !has(expense, en)) {
      expense.push({ name: en, emoji: String(vals[i][1] || ''), color: String(vals[i][2] || '') });
    }
    var inn = String(vals[i][3] || '').trim();
    if (inn && !has(income, inn)) {
      income.push({ name: inn, emoji: String(vals[i][4] || ''), color: String(vals[i][5] || '') });
    }
  }
  return { expense: expense, income: income };
}

function writeCategories_(expense, income) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CATEGORIES);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet.clearContents();
    var rows = [CAT_HEADER];
    var n = Math.max(expense.length, income.length);
    for (var i = 0; i < n; i++) {
      var e = expense[i] || { name: '', emoji: '', color: '' };
      var c = income[i] || { name: '', emoji: '', color: '' };
      rows.push([e.name, e.emoji, e.color, c.name, c.emoji, c.color]);
    }
    sheet.getRange(1, 1, rows.length, 6).setValues(rows);
  } finally {
    lock.releaseLock();
  }
}

/* ═══ עזרי תשתית ═════════════════════════════════════════ */
function ensureSetup_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET_EXPENSES, TX_HEADER);
  ensureSheet_(ss, SHEET_INCOMES, TX_HEADER);
  ensureSheet_(ss, SHEET_RECURRING, REC_HEADER);
  var catSheet = ensureSheet_(ss, SHEET_CATEGORIES, CAT_HEADER);
  /* זריעת קטגוריות ברירת מחדל בהקמה ראשונה */
  if (catSheet.getLastRow() < 2) {
    var rows = [];
    var n = Math.max(DEFAULT_EXPENSE_CATS.length, DEFAULT_INCOME_CATS.length);
    for (var i = 0; i < n; i++) rows.push([DEFAULT_EXPENSE_CATS[i] || '', DEFAULT_INCOME_CATS[i] || '']);
    catSheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }
}

function ensureSheet_(ss, name, header) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function toDate_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === 'string' && v) {
    /* DD/MM/YYYY או DD/MM/YYYY HH:mm */
    var m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0));
    var d = new Date(v);
    if (!isNaN(d)) return d;
  }
  return null;
}

function fmtDate_(d) {
  /* פורמט לפי רכיבי התאריך כפי שהם בגיליון — ללא המרת אזור-זמן,
     כדי שהתאריך לא יזוז ביום אם אזור הזמן של הפרויקט שונה. */
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function cleanCatList_(list) {
  if (!list || !list.length) return [];
  var out = [];
  for (var i = 0; i < list.length && out.length < 60; i++) {
    var item = list[i];
    var o = (item && typeof item === 'object') ? item : { name: item };
    var name = String(o.name || '').trim().slice(0, 40);
    if (!name) continue;
    var dup = false;
    for (var j = 0; j < out.length; j++) if (out[j].name === name) { dup = true; break; }
    if (dup) continue;
    out.push({
      name: name,
      emoji: String(o.emoji || '').slice(0, 8),
      color: String(o.color || '').slice(0, 16)
    });
  }
  return out;
}
