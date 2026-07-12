/* ════════════════════════════════════════════════════════════
   api/delete-transaction.js — מחיקה פיזית של שורה מהגיליון
   POST { uid, type? }
   ⇒ Make (MAKE_DELETE_URL)
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

    /* סוג התנועה עוזר לתרחיש ב-Make לדעת באיזה גיליון לחפש */
    const type = body.type === 'income' ? 'income'
               : body.type === 'expense' ? 'expense'
               : undefined;

    const { status, data } = await forwardToScript({
      action: 'delete',
      uid,
      ...(type ? { type } : {})
    });

    if (status < 200 || status >= 300 || data.ok === false) {
      console.error('[delete-transaction] Google Script returned', status, data);
      const notFound = data.error && String(data.error).indexOf('not found') !== -1;
      return res.status(notFound ? 404 : 502).json({ ok: false, error: data.error || ('Google Script returned ' + status) });
    }

    return res.status(200).json({ ok: true, uid, deleted: true });
  } catch (err) {
    return fail(res, err);
  }
};
