/* ════════════════════════════════════════════════════════════
   sw.js — Service Worker · "הכסף שלנו"
   אסטרטגיה:
   • App Shell (index.html, manifest, אייקונים) נשמר ב-Cache
     בהתקנה — האפליקציה עולה מיידית גם בניתוק רשת.
   • ניווט (HTML): Cache-First עם רענון שקט ברקע
     (Stale-While-Revalidate) — ה-HTML מוגש מה-Cache המקומי
     תוך 0 מילישניות (מסך הפתיחה נעלם מיידית), ורק *אחרי* זה
     נבדק עדכון מהרשת ברקע לפעם הבאה. פריסה חדשה ב-Vercel
     נקלטת בעלייה הבאה של האפליקציה, לא באותה עלייה — זה המחיר
     המכוון של הארכיטקטורה: בקשת רשת תלויה/איטית (Hanging
     Request, קליטה חלשה) לעולם לא תוקעת יותר את עליית הממשק.
   • נכסים סטטיים אחרים: Cache-First עם עדכון ברקע (ללא שינוי).
   • ‎/api/‎ וכל בקשה שאינה GET — עוקפים את ה-SW לחלוטין.
     לעולם לא שומרים ב-Cache נתונים פיננסיים או תשובות API.

   • ‎/quick-add.html‎ (הווידג'ט להזנה מהירה) חלק מה-App Shell —
     נטען גם אופליין, עם גיבוי Cache נפרד מ-index.html.

   ⚠️ בכל פריסה שמשנה את index.html או quick-add.html — העלו את VERSION,
      וה-SW הישן על כל המכשירים יוחלף וינקה את ה-Cache שלו.
      (קובצי ה-Manifest מוגשים Network-First — הם מתעדכנים מיד
       עם כל פריסה, בלי צורך בהעלאת VERSION.)
   ════════════════════════════════════════════════════════════ */
'use strict';

const VERSION = 'v24';
const CACHE_NAME = 'family-finance-' + VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './quick-add.html',
  './manifest.json',
  './quick-add-manifest.json',
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

  /* 3.5 קובצי Manifest (manifest.json / quick-add-manifest.json) —
        Network-First: שינויי id/scope/start_url נקלטים בכרום מיד
        עם הפריסה, בלי תלות בהעלאת VERSION. באופליין — Cache.   */
  if (url.pathname.endsWith('manifest.json')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  /* 4. ניווט / HTML — Cache-First עם רענון שקט ברקע.
        אם קיים עותק ב-Cache: מוגש מיידית (0ms), בלי לחכות
        לרשת בכלל — וברקע, ללא חסימה, נשלחת בקשת fetch נפרדת
        שרק מעדכנת את ה-Cache לפעם הבאה (fire-and-forget; אין
        respondWith שני, ולכן שום Hang שלה לא יכול לתקוע דבר).
        אין Cache (עלייה ראשונה בלבד) — אין ברירה אלא להמתין
        לרשת; נפילה אחרונה ל-'./' אם גם זה נכשל.
        ‎/quick-add‎ מקבל גיבוי משלו — שלא יוגש index.html בטעות. */
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    const isQuickAdd = url.pathname === '/quick-add' || url.pathname.endsWith('/quick-add.html');
    const shellKey = isQuickAdd ? './quick-add.html' : './index.html';
    event.respondWith(
      caches.match(shellKey).then((cached) => {
        const revalidate = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(shellKey, copy));
            }
            return res;
          })
          .catch(() => null);

        if (cached) {
          revalidate.catch(() => {}); /* רקע בלבד — לא נחכה לה */
          return cached;
        }
        /* אין Cache עדיין — חייבים רשת; אם גם היא נכשלת, ננסה שורש */
        return revalidate.then((res) => res || caches.match('./'));
      })
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
