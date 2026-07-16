/* ════════════════════════════════════════════════════════════
   api/_lib.js — ליבה משותפת לכל נקודות הקצה
   (הקידומת "_" מונעת מ-Vercel לחשוף את הקובץ כ-Endpoint)

   אחריות:
   1. אימות X-App-Secret מול process.env.APP_SECRET_TOKEN
      בהשוואה בטוחה (timingSafeEqual) — חסינה ל-Timing Attacks.
   2. קריאת גוף הבקשה בצורה עמידה (req.body או זרם גולמי).
   3. שיגור ל-Webhook של Make והחזרת תשובה אחידה,
      כולל טיפול במקרה ש-Make מחזיר "Accepted" כטקסט ולא JSON.
   ════════════════════════════════════════════════════════════ */
'use strict';

const crypto = require('crypto');

/* ── השוואה בטוחה ─────────────────────────────────────────
   timingSafeEqual דורש באפרים באורך זהה, לכן משווים
   SHA-256 של שני הערכים — אורך קבוע, ללא דליפת אורך הסוד. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* ── חילוץ הטוקן מהבקשה — שלוש כותרות נתמכות ─────────────
   כולן מאומתות מול *אותו* משתנה סביבה: APP_SECRET_TOKEN.
   1. X-App-Secret            (הדשבורד הראשי)
   2. Authorization: Bearer … (הווידג'ט / כלים חיצוניים)
   3. X-Api-Key               (Shortcuts / Tasker וכו')
   trim מנקה רווחים/ירידות שורה שמגיעים מהעתק-הדבק של הטוקן. */
function extractToken(req) {
  var h = req.headers || {};
  var v = h['x-app-secret'];
  if (!v) {
    var auth = String(h['authorization'] || '');
    if (/^Bearer\s+/i.test(auth)) v = auth.replace(/^Bearer\s+/i, '');
  }
  if (!v) v = h['x-api-key'];
  return String(v || '').trim();
}

/* ── שער כניסה אחיד: מתודה + אימות ──────────────────────
   מחזיר true אם הבקשה עברה; אחרת כבר כתב את התשובה וסיים. */
function guard(req, res) {
  /* CORS: מאפשר קריאות מכלים חיצוניים (ווידג'טים, Shortcuts).
     זו אינה שכבת אבטחה — האימות האמיתי הוא הטוקן שבכותרת. */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret, Authorization, X-Api-Key');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed — POST only' });
    return false;
  }

  const expected = String(process.env.APP_SECRET_TOKEN || '').trim();
  if (!expected) {
    /* תקלת תצורה בשרת — לא באשמת הלקוח, אבל אסור להכניס אף אחד */
    console.error('[auth] APP_SECRET_TOKEN is not configured in Vercel env');
    res.status(500).json({ ok: false, error: 'Server misconfiguration' });
    return false;
  }

  const provided = extractToken(req);
  if (!safeEqual(provided, expected)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

/* ── קריאת גוף הבקשה ─────────────────────────────────────
   Vercel מפרסר JSON אוטומטית ל-req.body, אך ליתר ביטחון
   נופלים לקריאת הזרם הגולמי אם body לא קיים. */
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

/* ── שיגור ל-Google Apps Script ──────────────────────────
   כתובת אחת ויחידה (GOOGLE_SCRIPT_URL) לכל הפעולות; הפעולה
   נבחרת לפי payload.action בצד ה-GAS.
   הערות חשובות:
   • GAS עונה ל-POST עם 302 Redirect לדומיין תוכן — fetch של
     Node עוקב אחריו אוטומטית (redirect: 'follow').
   • אם מוגדר GAS_API_KEY בסביבה — הוא מוזרק כ-payload.key
     ונאכף בסקריפט (שכבת אבטחה שנייה מעבר ל-X-App-Secret). */
async function forwardToScript(payload) {
  const url = process.env.GOOGLE_SCRIPT_URL;
  if (!url) {
    const err = new Error('Missing env var: GOOGLE_SCRIPT_URL');
    err.code = 'ENV_MISSING';
    throw err;
  }

  const body = Object.assign({}, payload);
  if (process.env.GAS_API_KEY) body.key = process.env.GAS_API_KEY;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000); /* 25s תקרה */

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await upstream.text();
  let data;
  try {
    data = text ? JSON.parse(text) : { ok: upstream.ok };
  } catch (e) {
    /* GAS החזיר HTML (למשל דף שגיאת הרשאות של גוגל) */
    data = { ok: false, raw: text.slice(0, 500) };
  }
  return { status: upstream.status, data };
}

/* ── עטיפת שגיאות אחידה ל-Handler ───────────────────────── */
function fail(res, err) {
  if (err && err.code === 'ENV_MISSING') {
    console.error('[config]', err.message);
    return res.status(500).json({ ok: false, error: 'Server misconfiguration' });
  }
  if (err && err.name === 'AbortError') {
    return res.status(504).json({ ok: false, error: 'Google Script timeout' });
  }
  console.error('[api error]', err);
  return res.status(502).json({ ok: false, error: 'Upstream (Google Script) request failed' });
}

module.exports = { safeEqual, extractToken, guard, readBody, forwardToScript, fail };
