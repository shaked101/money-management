/* ════════════════════════════════════════════════════════════
   api/sync-tags.js — עדכון גיליון 'תיוגים' (תתי-קטגוריות)
   תומך בשני מצבים:
   א. החלפה מלאה לקטגוריה אחת:
        POST { category: 'סופר', tags: ['ירקות','בשר'] }
        (מערך ריק = מחיקת כל תיוגי הקטגוריה)
   ב. שינוי שם קטגוריה (העברת התיוגים לשם החדש):
        POST { op: 'rename', from: 'ישן', to: 'חדש' }
   ⇒ Google Apps Script (action: 'categories' + tagsFor/tagsRename)
   ⇒ { ok: true, tags: { 'קטגוריה': ['תיוג', ...] } }
   ════════════════════════════════════════════════════════════ */
'use strict';

const { guard, readBody, forwardToScript, fail } = require('./_lib.js');

const MAX_TAGS = 40;
const MAX_TAG_LEN = 30;
const MAX_CAT_LEN = 40;

module.exports = async function handler(req, res) {
  if (!guard(req, res)) return; /* 401 / 405 / 500 כבר נשלחו */

  try {
    const body = await readBody(req);
    let payload;

    if (body.op === 'rename') {
      /* ── מצב ב: שינוי שם קטגוריה ── */
      const from = String(body.from ?? '').trim().slice(0, MAX_CAT_LEN);
      const to = String(body.to ?? '').trim().slice(0, MAX_CAT_LEN);
      if (!from || !to) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid rename — expected { op: "rename", from, to }'
        });
      }
      payload = { action: 'categories', tagsRename: { from, to } };
    } else if (body.category !== undefined && Array.isArray(body.tags)) {
      /* ── מצב א: החלפה מלאה לקטגוריה אחת ── */
      const category = String(body.category ?? '').trim().slice(0, MAX_CAT_LEN);
      if (!category) {
        return res.status(400).json({ ok: false, error: 'Missing category' });
      }
      const tags = [];
      for (const item of body.tags) {
        const t = String(item ?? '').trim().slice(0, MAX_TAG_LEN);
        if (t && !tags.includes(t)) tags.push(t);
        if (tags.length >= MAX_TAGS) break;
      }
      payload = { action: 'categories', tagsFor: category, tags };
    } else {
      return res.status(400).json({
        ok: false,
        error: 'Expected { category, tags: [] } or { op: "rename", from, to }'
      });
    }

    const { status, data } = await forwardToScript(payload);

    if (status < 200 || status >= 300 || data.ok === false) {
      console.error('[sync-tags] Google Script returned', status, data);
      return res.status(502).json({ ok: false, error: data.error || ('Google Script returned ' + status) });
    }

    return res.status(200).json({ ok: true, synced: data.synced || 'tags', tags: data.tags || {} });
  } catch (err) {
    return fail(res, err);
  }
};
