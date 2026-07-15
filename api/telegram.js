export default async function handler(req, res) {
  // מוודאים שטלגרם שולח בקשת POST
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // שולף את הכתובת של גוגל מתוך משתני הסביבה שלך בורסל
  const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

  if (!GOOGLE_SCRIPT_URL) {
    console.error("Missing GOOGLE_SCRIPT_URL in Vercel environment variables");
    return res.status(500).send('Server configuration error');
  }

  try {
    // 1. משדרים את המידע לגוגל סקריפט
    // שים לב: אנחנו לא מחכים שגוגל יסיים כדי לענות לטלגרם
    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body) // מעבירים את ה-Payload של טלגרם בדיוק כמו שהוא
    });

    // 2. חותכים את הלופ! מחזירים 200 לטלגרם מיד.
    return res.status(200).json({ status: 'ok' });

  } catch (error) {
    console.error('Error forwarding to Google:', error);
    // גם אם משהו קרס, מחזירים 200 לטלגרם כדי שהתור לא ייתקע לעולם
    return res.status(200).json({ status: 'ok', error: 'Forwarding failed but acknowledged' });
  }
}
