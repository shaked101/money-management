/* ════════════════════════════════════════════════════════════
   api/sync-categories.js — עדכון גיליון הקטגוריות
   תומך בשני מצבים:
   א. סנכרון מלא:  POST { categories: { expense:[…], income:[…] } }
   ב. פעולה בודדת: POST { op:'add'|'remove', kind:'expense'|'income', name }
   ⇒ Make (MAKE_CATEGORIES_URL)
   ════════════════════════════════════════════════════════════ */
'use strict';

const { guard, readBody, forwardToScript, fail } = require('./_lib.js');

const MAX_CATS = 60;
const MAX_NAME = 40;

function cleanList(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const item of list) {
    /* תומך גם במחרוזות וגם באובייקטים {name, emoji, color} */
    const src = (item && typeof item === 'object') ? item : { name: item };
    const name = String(src.name ?? '').trim().slice(0, MAX_NAME);
    if (!name || out.some((x) => x.name === name)) continue;
    out.push({
      name,
      emoji: String(src.emoji ?? '').slice(0, 8),
      color: String(src.color ?? '').slice(0, 16),
      fav: src.fav === true || src.fav === 'true'
    });
    if (out.length >= MAX_CATS) break;
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (!guard(req, res)) return;

  try {
    const body = await readBody(req);
    let payload;

    if (body.categories) {
      /* ── מצב א: סנכרון מלא ── */
      const expense = cleanList(body.categories.expense);
      const income = cleanList(body.categories.income);
      if (!expense || !income) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid categories — expected { categories: { expense: [], income: [] } }'
        });
      }
      payload = {
        action: 'categories',
        categories: { expense, income }
      };
    } else if (body.op === 'add' || body.op === 'remove') {
      /* ── מצב ב: פעולה בודדת ── */
      const kind = body.kind === 'income' ? 'income'
                 : body.kind === 'expense' ? 'expense'
                 : null;
      const name = String(body.name ?? '').trim().slice(0, MAX_NAME);
      if (!kind || !name) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid op — expected { op, kind: expense|income, name }'
        });
      }
      payload = {
        action: 'categories',
        op: body.op,
        kind,
        name
      };
    } else {
      return res.status(400).json({ ok: false, error: 'Missing categories or op' });
    }

    const { status, data } = await forwardToScript(payload);

    if (status < 200 || status >= 300 || data.ok === false) {
      console.error('[sync-categories] Google Script returned', status, data);
      return res.status(502).json({ ok: false, error: data.error || ('Google Script returned ' + status) });
    }

    return res.status(200).json({ ok: true, synced: data.synced || 'full', categories: data.categories });
  } catch (err) {
    return fail(res, err);
  }
};
