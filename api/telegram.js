export default async function handler(req, res) {
  // 1. חסימת גישה מדפדפנים (מה שראית שעובד)
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // 2. משיכת הכתובת של גוגל ממשתני הסביבה
  const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

  if (!GOOGLE_SCRIPT_URL) {
    console.error("Missing GOOGLE_SCRIPT_URL in Vercel environment variables");
    return res.status(500).send('Server configuration error');
  }

  try {
    // 3. השליחה לגוגל - הוספנו await! 
    // עכשיו ורסל יחכה שהבקשה תצא לפני שהוא סוגר את הפונקציה.
    await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });

    // 4. החזרת 200 לטלגרם כדי לשחרר את התור
    return res.status(200).json({ status: 'ok' });

  } catch (error) {
    console.error('Error forwarding to Google:', error);
    return res.status(200).json({ status: 'ok', error: 'Forwarding failed but acknowledged' });
  }
}
