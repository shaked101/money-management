/* ════════════════════════════════════════════════════════════
   api/get-data.js — שליפת תנועות וקטגוריות לחודש נתון
   POST { month: 1-12, year: YYYY }
   ⇒ Make (MAKE_GET_DATA_URL) ⇒ { ok, rows:[…], categories:{…} }
   ════════════════════════════════════════════════════════════ */
'use strict';

const { guard, readBody, forwardToScript, fail } = require('./_lib.js');

module.exports = async function handler(req, res) {
  if (!guard(req, res)) return; /* 401 / 405 / 500 כבר נשלחו */

  try {
    const body = await readBody(req);
    const month = parseInt(body.month, 10);
    const year = parseInt(body.year, 10);

    if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid month/year — expected { month: 1-12, year: YYYY }'
      });
    }

    const { status, data } = await forwardToScript({ action: 'get', month, year });

    if (status < 200 || status >= 300 || data.ok === false) {
      console.error('[get-data] Google Script returned', status, data);
      return res.status(502).json({ ok: false, error: data.error || ('Google Script returned ' + status) });
    }

    /* נירמול: הדשבורד מצפה תמיד ל-rows (מערך) ו-categories (אובייקט).
       תומך גם במבנה שבו Make מחזיר מערך שורות ישירות. */
    const rows = Array.isArray(data.rows) ? data.rows
               : Array.isArray(data)      ? data
               : [];
    const categories =
      data.categories && Array.isArray(data.categories.expense)
        ? data.categories
        : undefined;

    /* תיוגים: מפה { 'קטגוריה': ['תיוג1','תיוג2'] } מגיליון 'תיוגים' */
    const tags =
      data.tags && typeof data.tags === 'object' && !Array.isArray(data.tags)
        ? data.tags
        : undefined;

    return res.status(200).json({
      ok: true,
      rows,
      ...(categories ? { categories } : {}),
      ...(tags ? { tags } : {})
    });
  } catch (err) {
    return fail(res, err);
  }
};
