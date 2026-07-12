/* ════════════════════════════════════════════════════════════
   api/add-transaction.js — הוספת תנועה חדשה לגיליון
   POST { type, user|who, category, amount, notes|note, date? }
   מזריק UID + חותמת זמן ⇒ Make (MAKE_ADD_URL)
   ════════════════════════════════════════════════════════════ */
'use strict';

const crypto = require('crypto');
const { guard, readBody, forwardToMake, fail } = require('./_lib.js');

module.exports = async function handler(req, res) {
  if (!guard(req, res)) return;

  try {
    const body = await readBody(req);

    /* נירמול שמות שדות — הדשבורד שולח who/note, המפרט מדבר על
       user/notes; מקבלים את שניהם כדי שאף צד לא יישבר. */
    const type = body.type === 'income' ? 'income' : 'expense';
    const user = String(body.user ?? body.who ?? '').trim();
    const category = String(body.category ?? '').trim();
    const notes = String(body.notes ?? body.note ?? '').trim();
    const amount = Number(body.amount);

    if (!category) {
      return res.status(400).json({ ok: false, error: 'Missing category' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid amount — must be a positive number' });
    }
    if (!user) {
      return res.status(400).json({ ok: false, error: 'Missing user (who)' });
    }

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

    const row = {
      action: 'add-transaction',
      uid,
      createdAt,
      date,
      type,
      user,
      category,
      amount,
      notes,
      recurring: body.recurring === true || body.recurring === 'true'
    };

    const { status, data } = await forwardToMake('MAKE_ADD_URL', row);

    if (status < 200 || status >= 300) {
      console.error('[add-transaction] Make returned', status, data);
      return res.status(502).json({ ok: false, error: 'Make returned ' + status });
    }

    /* מחזירים ללקוח את השורה כפי שנשמרה (כולל ה-UID הסופי) */
    return res.status(200).json({ ok: true, row });
  } catch (err) {
    return fail(res, err);
  }
};
