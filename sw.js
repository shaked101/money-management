/* ════════════════════════════════════════════════════════════
   sw.js — Service Worker · "הכסף שלנו"
   אסטרטגיה:
   • App Shell (index.html, manifest, אייקונים) נשמר ב-Cache
     בהתקנה — האפליקציה עולה מיידית גם בניתוק רשת.
   • ניווט (HTML): Network-First עם נפילה ל-Cache — כך פריסה
     חדשה ב-Vercel נטענת מיד כשיש רשת, וה-Cache משמש רק כגיבוי.
   • נכסים סטטיים אחרים: Cache-First עם עדכון ברקע.
   • ‎/api/‎ וכל בקשה שאינה GET — עוקפים את ה-SW לחלוטין.
     לעולם לא שומרים ב-Cache נתונים פיננסיים או תשובות API.

   ⚠️ בכל פריסה שמשנה את index.html — העלו את VERSION,
      וה-SW הישן על כל המכשירים יוחלף וינקה את ה-Cache שלו.
   ════════════════════════════════════════════════════════════ */
'use strict';

const VERSION = 'v2';
const CACHE_NAME = 'family-finance-' + VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* ── התקנה: קליטת ה-App Shell ─────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ── הפעלה: ניקוי גרסאות Cache ישנות ─────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('family-finance-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ───────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  /* 1. לא GET (כל ה-CRUD שלנו הוא POST) — לא נוגעים */
  if (req.method !== 'GET') return;

  /* 2. כל נתיב API — ישירות לרשת, בלי Cache, בלי fallback */
  if (url.pathname.startsWith('/api/')) return;

  /* 3. דומיינים חיצוניים (Google Fonts וכו') — Cache-First עדין */
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => hit) /* אופליין ואין ב-Cache — נכשל בשקט */
      )
    );
    return;
  }

  /* 4. ניווט / HTML — Network-First, Cache כגיבוי אופליין */
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() =>
          caches.match('./index.html').then((hit) => hit || caches.match('./'))
        )
    );
    return;
  }

  /* 5. שאר הנכסים הסטטיים באותו Origin — Cache-First */
  event.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
    )
  );
});
