/* ════════════════════════════════════════════════════════════
   api/get-live-categories.js — רשימת קטגוריות לאפליקציית
   קיצורי הדרך באנדרואיד (Shortcuts / Tasker / HTTP Request)

   GET /api/get-live-categories?token=XXXX[&kind=expense|income|all]
   ⇒ Make (MAKE_CATEGORIES_URL, action: get-categories)
   ⇒ מערך JSON שטוח: ["סופר","רכב ודלק",...]

   🔐 אבטחה: Token ייעודי ב-Query Param, מאומת ב-safeEqual מול
   process.env.CATEGORIES_READ_TOKEN — בכוונה *לא* ה-APP_SECRET_TOKEN
   הראשי: כתובות URL נשמרות בהיסטוריה וביומני גישה, ולכן טוקן
   שעובר ב-URL חייב להיות בעל הרשאה נמוכה (קריאת קטגוריות בלבד).
   גם אם ידלוף — אי אפשר לקרוא תנועות, להוסיף או למחוק דבר.
   ════════════════════════════════════════════════════════════ */
'use strict';

const { safeEqual, forwardToScript, fail } = require('./_lib.js');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed — GET only' });
  }

  /* ── אימות Token (Fail-Closed) ── */
  const expected = process.env.CATEGORIES_READ_TOKEN;
  if (!expected) {
    console.error('[auth] CATEGORIES_READ_TOKEN is not configured in Vercel env');
    return res.status(500).json({ ok: false, error: 'Server misconfiguration' });
  }
  const provided = (req.query && req.query.token) ? String(req.query.token) : '';
  if (!safeEqual(provided, expected)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  /* ── סינון אופציונלי לפי סוג ── */
  const kindParam = (req.query && req.query.kind) ? String(req.query.kind) : 'all';
  const kind = ['expense', 'income', 'all'].includes(kindParam) ? kindParam : 'all';

  try {
    const { status, data } = await forwardToScript({ action: 'categories' });

    if (status < 200 || status >= 300 || data.ok === false) {
      console.error('[get-live-categories] Google Script returned', status, data);
      return res.status(502).json({ ok: false, error: data.error || ('Google Script returned ' + status) });
    }

    /* נירמול: תומך בכל אחד מהמבנים —
       { categories:{expense:[],income:[]} } | {expense:[],income:[]} | [...] */
    const cats = (data && data.categories) ? data.categories : data;
    let list;
    if (Array.isArray(cats)) {
      list = cats;
    } else if (cats && (Array.isArray(cats.expense) || Array.isArray(cats.income))) {
      const exp = Array.isArray(cats.expense) ? cats.expense : [];
      const inc = Array.isArray(cats.income) ? cats.income : [];
      list = kind === 'expense' ? exp
           : kind === 'income'  ? inc
           : exp.concat(inc);
    } else {
      list = [];
    }

    /* ניקוי: מחרוזות בלבד, ללא ריקים וכפילויות */
    const clean = [];
    for (const item of list) {
      const raw = (item && typeof item === 'object' && item.name != null) ? item.name : item;
      const name = String(raw ?? '').trim();
      if (name && clean.indexOf(name) === -1) clean.push(name);
    }

    /* תשובות חיות בלבד — בלי Cache בדפדפן/CDN */
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(clean);
  } catch (err) {
    return fail(res, err);
  }
};
