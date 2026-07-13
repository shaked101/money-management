/* ════════════════════════════════════════════════════════════
   api/update-transaction.js — עדכון תנועה קיימת לפי UID
   POST { uid, type, user|who, category, amount, notes|note, date?, recurring? }
   ⇒ Google Apps Script (action: update)
   ה-GAS מאתר את השורה לפי ה-UID, מוחק אותה וכותב את הגרסה
   המעודכנת לגיליון הנכון — כולל מעבר בין הוצאה/הכנסה/קבועה.
   ════════════════════════════════════════════════════════════ */
'use strict';

const { guard, readBody, forwardToScript, fail } = require('./_lib.js');

module.exports = async function handler(req, res) {
  if (!guard(req, res)) return;

  try {
    const body = await readBody(req);

    const uid = String(body.uid ?? '').trim();
    if (!uid || uid.length > 120) {
      return res.status(400).json({ ok: false, error: 'Missing or invalid uid' });
    }

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

    let date = String(body.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
      date = new Date().toISOString().slice(0, 10);
    }

    const { status, data } = await forwardToScript({
      action: 'update',
      uid,
      date,
      type,
      user,
      category,
      amount,
      notes,
      recurring: body.recurring === true || body.recurring === 'true'
    });

    if (status < 200 || status >= 300 || data.ok === false) {
      console.error('[update-transaction] Google Script returned', status, data);
      const notFound = data.error && String(data.error).indexOf('not found') !== -1;
      return res.status(notFound ? 404 : 502).json({ ok: false, error: data.error || ('Google Script returned ' + status) });
    }

    return res.status(200).json({ ok: true, row: data.row });
  } catch (err) {
    return fail(res, err);
  }
};
