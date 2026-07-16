/* ════════════════════════════════════════════════════════════
   api/get-categories.js — קטגוריות + תיוגים במבנה מלא
   נועד לווידג'ט ההזנה המהירה (/quick-add): קריאה אחת קלה
   שמחזירה הכל, בלי למשוך את תנועות החודש כמו get-data.

   POST {} (גוף ריק) + כותרת X-App-Secret
   ⇒ Google Apps Script (action: 'categories', קריאה בלבד)
   ⇒ { ok, categories: { expense:[{name,emoji,color,fav}], income:[…] },
        tags: { 'קטגוריה': ['תיוג', ...] } }
   ════════════════════════════════════════════════════════════ */
'use strict';

const { guard, readBody, forwardToScript, fail } = require('./_lib.js');

module.exports = async function handler(req, res) {
  if (!guard(req, res)) return; /* 401 / 405 / 500 כבר נשלחו */

  try {
    await readBody(req); /* הגוף לא נדרש — נקרא רק כדי לרוקן את הזרם */

    const { status, data } = await forwardToScript({ action: 'categories' });

    if (status < 200 || status >= 300 || data.ok === false) {
      console.error('[get-categories] Google Script returned', status, data);
      return res.status(502).json({ ok: false, error: data.error || ('Google Script returned ' + status) });
    }

    const categories =
      data.categories && (Array.isArray(data.categories.expense) || Array.isArray(data.categories.income))
        ? data.categories
        : { expense: [], income: [] };

    const tags =
      data.tags && typeof data.tags === 'object' && !Array.isArray(data.tags)
        ? data.tags
        : {};

    /* תשובות חיות בלבד — הווידג'ט מנהל Cache משלו ב-localStorage */
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, categories, tags });
  } catch (err) {
    return fail(res, err);
  }
};
