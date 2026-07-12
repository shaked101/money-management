/* ════════════════════════════════════════════════════════════
   api/delete-transaction.js — מחיקה פיזית של שורה מהגיליון
   POST { uid, type? }
   ⇒ Make (MAKE_DELETE_URL)
   ════════════════════════════════════════════════════════════ */
'use strict';

const { guard, readBody, forwardToMake, fail } = require('./_lib.js');

module.exports = async function handler(req, res) {
  if (!guard(req, res)) return;

  try {
    const body = await readBody(req);

    const uid = String(body.uid ?? '').trim();
    if (!uid || uid.length > 120) {
      return res.status(400).json({ ok: false, error: 'Missing or invalid uid' });
    }

    /* סוג התנועה עוזר לתרחיש ב-Make לדעת באיזה גיליון לחפש */
    const type = body.type === 'income' ? 'income'
               : body.type === 'expense' ? 'expense'
               : undefined;

    const { status, data } = await forwardToMake('MAKE_DELETE_URL', {
      action: 'delete-transaction',
      uid,
      ...(type ? { type } : {})
    });

    if (status < 200 || status >= 300) {
      console.error('[delete-transaction] Make returned', status, data);
      return res.status(502).json({ ok: false, error: 'Make returned ' + status });
    }

    return res.status(200).json({ ok: true, uid, deleted: true });
  } catch (err) {
    return fail(res, err);
  }
};
