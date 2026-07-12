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

/* ── שער כניסה אחיד: מתודה + אימות ──────────────────────
   מחזיר true אם הבקשה עברה; אחרת כבר כתב את התשובה וסיים. */
function guard(req, res) {
  /* CORS: מאפשר קריאות מכלים חיצוניים (ווידג'טים, Shortcuts).
     זו אינה שכבת אבטחה — האימות האמיתי הוא X-App-Secret. */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret');
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

  const expected = process.env.APP_SECRET_TOKEN;
  if (!expected) {
    /* תקלת תצורה בשרת — לא באשמת הלקוח, אבל אסור להכניס אף אחד */
    console.error('[auth] APP_SECRET_TOKEN is not configured in Vercel env');
    res.status(500).json({ ok: false, error: 'Server misconfiguration' });
    return false;
  }

  const provided = req.headers['x-app-secret'] || '';
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

/* ── שיגור ל-Make ────────────────────────────────────────
   envKey: שם משתנה הסביבה שמכיל את כתובת ה-Webhook.
   מחזיר { status, data } כאשר data הוא תמיד אובייקט:
   אם Make החזיר טקסט (למשל "Accepted"), הוא נעטף. */
async function forwardToMake(envKey, payload) {
  const url = process.env[envKey];
  if (!url) {
    const err = new Error(`Missing env var: ${envKey}`);
    err.code = 'ENV_MISSING';
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000); /* 25s תקרה */

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
    /* Make ללא מודול Webhook Response מחזיר "Accepted" כטקסט */
    data = { ok: upstream.ok, raw: text.slice(0, 500) };
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
    return res.status(504).json({ ok: false, error: 'Make webhook timeout' });
  }
  console.error('[api error]', err);
  return res.status(502).json({ ok: false, error: 'Upstream (Make) request failed' });
}

module.exports = { safeEqual, guard, readBody, forwardToMake, fail };
