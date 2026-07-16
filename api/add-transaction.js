/* ════════════════════════════════════════════════════════════
   api/add-transaction.js — הוספת תנועה חדשה לגיליון
   POST { type, user|who, category, amount, notes|note, date? }
   מזריק UID + חותמת זמן ⇒ Make (MAKE_ADD_URL)
   ════════════════════════════════════════════════════════════ */
'use strict';

const crypto = require('crypto');
const { guard, readBody, forwardToScript, fail } = require('./_lib.js');

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
    const tag = String(body.tag ?? '').trim().slice(0, 40); /* תיוג — אופציונלי */
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
      action: 'add',
      uid,
      createdAt,
      date,
      type,
      user,
      category,
      amount,
      notes,
      tag,
      recurring: body.recurring === true || body.recurring === 'true'
    };

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
