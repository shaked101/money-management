/* ════════════════════════════════════════════════════════════
   telegram-fix.gs — שני הבלוקים להחלפה ב-Code.gs
   החליפו את הפונקציות doPost ו-handleTelegramWebhook_ הקיימות
   בגרסאות שלמטה (או קחו את Code.gs המלא — לא את שניהם!).
   לאחר ההדבקה: Deploy → Manage deployments → New version,
   ואז הריצו פעם אחת setTelegramWebhook() לריקון התור התקוע.
   ════════════════════════════════════════════════════════════ */

/* ═══ נקודת הכניסה ═══════════════════════════════════════
   מבנה קשיח נגד לופ ההפעלות של טלגרם:
   • ענף האפליקציה (Vercel, עם action) מחזיר תשובת נתונים
     אמיתית — כולל שגיאות — כמו תמיד.
   • ענף הטלגרם *לעולם* לא מחזיר תשובה מתוך הלוגיקה: הטיפול
     רץ, מצליח / מסונן / נכשל — ובכל מקרה הזרימה נופלת אל
     שורת הברזל בתחתית הפונקציה, מחוץ לכל תנאי, שמחזירה
     {status:'ok'} — כך טלגרם מקבל 200 בכל תרחיש קיים בעולם. */
function doPost(e) {
  var isTelegram = false;
  var out = null;

  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    isTelegram = !!(p && (p.update_id !== undefined || p.message));

    if (isTelegram) {
      /* מטפל פנימי בלבד — אין לו ערך חוזר ואין ממנו תשובת HTTP */
      handleTelegramWebhook_(p);
    } else {
      requireKey_(p);
      switch (p.action) {
        case 'get':        out = actionGet_(p);        break;
        case 'add':        out = actionAdd_(p);        break;
        case 'update':     out = actionUpdate_(p);     break;
        case 'delete':     out = actionDelete_(p);     break;
        case 'categories': out = actionCategories_(p); break;
        default:
          out = { ok: false, error: 'Unknown action: ' + String(p.action) };
      }
    }
  } catch (err) {
    try { Logger.log('[doPost] שגיאה: ' + err); } catch (e2) {}
    if (!isTelegram) {
      out = { ok: false, error: String((err && err.message) || err) };
    }
  }

  /* מסלול האפליקציה: תשובת נתונים / שגיאה ל-Vercel */
  if (!isTelegram) {
    return ContentService
      .createTextOutput(JSON.stringify(out || { ok: false, error: 'Empty response' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  /* ══ שורת הברזל — תמיד רצה במסלול טלגרם, מחוץ לכל תנאי ══ */
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── קליטת Webhook: לוגיקה פנימית בלבד, ללא תשובת HTTP ──
   כל return כאן הוא יציאה מהטיפול הפנימי בלבד; תשובת ה-200
   לטלגרם נמסרת תמיד ע"י שורת הברזל בתחתית doPost.
   ▸ דה-דופליקציה לפי update_id (CacheService) — ניסיון חוזר
     של טלגרם מדולג מיידית, בלי הודעה כפולה.
   ▸ השוואת chat_id: String מול String, מפורש.               */
var ALLOWED_CHAT_ID = '-5003500959';

function handleTelegramWebhook_(u) {
  try {
    /* דה-דופליקציה: Update שכבר טופל — דילוג מיידי */
    var updateId = (u && u.update_id !== undefined) ? String(u.update_id) : '';
    if (updateId) {
      var cache = CacheService.getScriptCache();
      if (cache.get('tg_upd_' + updateId)) {
        Logger.log('[telegram] update ' + updateId + ' כבר טופל — מדולג (עצירת לופ)');
        return;
      }
      cache.put('tg_upd_' + updateId, '1', 21600); /* 6 שעות */
    }

    var msg = u.message || u.edited_message;
    if (!msg || !msg.chat) {
      Logger.log('[telegram] update ' + updateId + ' ללא הודעת טקסט (אירוע קבוצה?) — מדולג');
      return;
    }

    /* ── אימות Chat ID: המרה מפורשת למחרוזת בשני האגפים ── */
    var incomingChatId = msg.chat.id;
    var allowed = tgProp_('CHAT_ID', '') || ALLOWED_CHAT_ID;
    if (String(incomingChatId) !== String(allowed)) {
      Logger.log('[telegram] סונן ✗ | chat_id שהתקבל="' + String(incomingChatId) +
                 '" | מורשה="' + String(allowed) + '" | (אם זו הקבוצה שלכם — עדכנו CHAT_ID לערך שבלוג)');
      return; /* יציאה פנימית בלבד — doPost עדיין יחזיר 200 למטה */
    }

    var text = String(msg.text || '').trim();
    Logger.log('[telegram] אושר ✓ | update=' + updateId +
               ' | chat_id="' + String(incomingChatId) + '" | text="' + text.slice(0, 60) + '"');

    /* פקודות בקבוצות מגיעות לעיתים כ-"/start@BotName" */
    if (text.indexOf('@') > 0 && text.charAt(0) === '/') text = text.split('@')[0];

    if (text === 'דוח יומי')                                  tgSend_(incomingChatId, buildDailyReport_());
    else if (text === 'דוח שבועי')                            tgSend_(incomingChatId, buildWeeklyReport_());
    else if (text === 'דוח חודשי')                            tgSend_(incomingChatId, buildMonthlyReport_());
    else if (text === 'סגירת חודש' || text === 'דוח 1 לחודש') tgSend_(incomingChatId, buildMonthCloseReport_());
    else /* הודעה ראשונה / '/start' / טקסט לא מזוהה → תפריט */
      tgSend_(incomingChatId, TG_HEADER + '\nשלום! אני הבוט הפיננסי של שקד ואביטל.\nבחרו דוח מהתפריט למטה 👇');
  } catch (err) {
    Logger.log('[telegram] שגיאה בטיפול: ' + err);
    /* בכוונה בולעים — האישור לטלגרם נמסר ב-doPost בכל מקרה */
  }
}
