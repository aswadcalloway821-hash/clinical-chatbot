require('dotenv').config();
const apiKey = process.env.GEMINI_API_KEY;

const modelsToTest = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash'
];

(async () => {
  for (const m of modelsToTest) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'سلام عليكم، كم سعر كشفية الأسنان؟' }] }],
          systemInstruction: { parts: [{ text: 'أنت موظف استقبال في عيادة ابتسامة البصرة. اكتب بلهجة عراقية محببة بدون إيموجيات أو ماركداون. أرجع JSON { replyText, intent }' }] },
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
        })
      });

      console.log(`Model: ${m} -> STATUS: ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        console.log(`✅ SUCCESS [${m}]:`, data?.candidates?.[0]?.content?.parts?.[0]?.text);
      } else {
        const err = await res.text();
        console.log(`❌ FAIL [${m}]:`, err);
      }
    } catch (e) {
      console.log(`❌ ERROR [${m}]:`, e.message);
    }
  }
})();
