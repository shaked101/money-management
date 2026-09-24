/* ════════════════════════════════════════════════════════════
   api/add-transaction.js — הוספת תנועה חדשה לגיליון
   ▸ תנועה בודדת: POST { type, user|who, category, amount, notes|note, date? }
     מזריק UID + חותמת זמן ⇒ Apps Script (action:'add')
   ▸ פיצול הוצאות (Split): POST { items:[ {...כמו למעלה...}, ... ], groupId? }
     כל איבר ב-items מנורמל ומאומת *באותה* לוגיקה בדיוק כמו תנועה
     בודדת (UID+תאריך+ולידציה), ואז כל המערך מועבר יחד ל-Apps
     Script כ-{ action:'add', items:[...], groupId }, בדיוק בפורמט
     ש-actionAdd_ שם יודע לקבל (ראו Code.gs — p.items). זיהוי המצב
     נעשה לפי body.items (מערך לא-ריק) — בלי items, ההתנהגות
     זהה ב-100% לתנועה בודדת כפי שהייתה עד כה.
   ════════════════════════════════════════════════════════════ */
'use strict';

const crypto = require('crypto');
const { guard, readBody, forwardToScript, fail } = require('./_lib.js');

/* ═══ נירמול + ולידציה של תנועה אחת — משותף לבודדת ולכל איבר בפיצול ═══
   שמות שדות: הדשבורד שולח who/note, המפרט מדבר על user/notes —
   מקבלים את שניהם כדי שאף צד לא יישבר. מחזיר { row } בהצלחה,
   או { error } בכשל ולידציה (השדה החסר/הלא-תקין). */
function normalizeItem_(body, defaultGroupId) {
  body = body || {};
  const type = body.type === 'income' ? 'income' : 'expense';
  const user = String(body.user ?? body.who ?? '').trim();
  const category = String(body.category ?? '').trim();
  const notes = String(body.notes ?? body.note ?? '').trim();
  const tag = String(body.tag ?? '').trim().slice(0, 40); /* תיוג — אופציונלי */
  const groupId = String(body.groupId ?? defaultGroupId ?? '').trim().slice(0, 60); /* פיצול הוצאות — אופציונלי */
  const amount = Number(body.amount);

  if (!category) return { error: 'Missing category' };
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Invalid amount — must be a positive number' };
  if (!user) return { error: 'Missing user (who)' };

  /* הזרקת UID וחותמת זמן בצד השרת — מקור אמת אחד.
     אם הלקוח כבר שלח uid (לרינדור אופטימי) — מכבדים אותו. */
  const uid = String(body.uid || '').trim() ||
    'tx_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
  const createdAt = new Date().toISOString();

  /* תאריך התנועה: תקין = נשמר, אחרת ברירת מחדל = היום (UTC) */
  let date = String(body.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
    date = createdAt.slice(0, 10);
  }

  return {
    row: {
      uid, createdAt, date, type, user, category, amount, notes, tag, groupId,
      recurring: body.recurring === true || body.recurring === 'true'
    }
  };
}

module.exports = async function handler(req, res) {
  if (!guard(req, res)) return;

  try {
    const body = await readBody(req);
    const rawItems = Array.isArray(body.items) ? body.items : null;
    const isSplit = !!(rawItems && rawItems.length);

    /* ═══════════════ מסלול פיצול (items[]) ═══════════════ */
    if (isSplit) {
      /* קבוצה משותפת: מה-payload החיצוני, או מהאיבר הראשון אם כבר
         נשלחה שם (הלקוח יוצר groupId פעם אחת ומצמיד לכל השורות) —
         ורק אם אף אחד מהם לא סיפק, נוצרת כאן כרשת ביטחון. */
      const groupId = String(body.groupId || rawItems[0]?.groupId || '').trim().slice(0, 60) ||
        ('grp_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'));

      const items = [];
      for (let i = 0; i < rawItems.length; i++) {
        const normalized = normalizeItem_(rawItems[i], groupId);
        if (normalized.error) {
          return res.status(400).json({ ok: false, error: 'Item ' + (i + 1) + ': ' + normalized.error });
        }
        items.push(normalized.row);
      }

      const payload = { action: 'add', items, groupId };
      const { status, data } = await forwardToScript(payload);

      if (status < 200 || status >= 300 || data.ok === false) {
        console.error('[add-transaction/split] Google Script returned', status, data);
        /* בכשל חלקי (רק חלק מהפריטים נכשלו) — מפרטים אילו, במקום
           הודעת שגיאה גנרית שמסתירה את הפריט הבעייתי בפועל. */
        const failedItems = Array.isArray(data && data.rows)
          ? data.rows.map(function (r, i) { return (r && !r.ok) ? ('#' + (i + 1) + ': ' + (r.error || 'שגיאה')) : null; })
                     .filter(Boolean)
          : [];
        const error = (data && data.error) ||
          (failedItems.length ? ('חלק מהפריטים בפיצול נכשלו — ' + failedItems.join('; ')) : ('Google Script returned ' + status));
        return res.status(502).json({ ok: false, error, rows: data && data.rows });
      }

      return res.status(200).json({ ok: true, group: true, groupId: data.groupId || groupId, rows: data.rows || items });
    }

    /* ═══════════════ מסלול תנועה בודדת — ללא שינוי בהתנהגות ═══════════════ */
    const normalized = normalizeItem_(body, '');
    if (normalized.error) {
      return res.status(400).json({ ok: false, error: normalized.error });
    }
    const row = { action: 'add', ...normalized.row };

    const { status, data } = await forwardToScript(row);

    if (status < 200 || status >= 300 || data.ok === false) {
      console.error('[add-transaction] Google Script returned', status, data);
      return res.status(502).json({ ok: false, error: data.error || ('Google Script returned ' + status) });
    }

    /* מחזירים ללקוח את השורה כפי שנשמרה ב-GAS (כולל חותמת הזמן) */
    return res.status(200).json({ ok: true, row: data.row || row });
  } catch (err) {
    return fail(res, err);
  }
};
