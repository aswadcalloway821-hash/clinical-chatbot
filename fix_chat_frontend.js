const fs = require('fs');

let html = fs.readFileSync('public/chat.html', 'utf8');

// 1. تحديث اسم النموذج في الواجهة من 2.5 إلى 3.1
html = html.replace(/gemini-2\.5-flash-lite/g, 'gemini-3.1-flash-lite');

// 2. دعم التشغيل المباشر لملفات file:// عبر ربط BASE_URL بـ Render تلقائياً عند فتح الملف محلياً
const oldFetchCode = `async function handleSend() {`;
const newFetchCode = `const BASE_URL = window.location.protocol.startsWith('file') ? 'https://clinical-chatbot-4uof.onrender.com' : '';

    async function handleSend() {`;

html = html.replace(oldFetchCode, newFetchCode);

html = html.replace("fetch('/api/test-chat/message'", "fetch(BASE_URL + '/api/test-chat/message'");
html = html.replace("fetch('/api/test-chat/reset-session'", "fetch(BASE_URL + '/api/test-chat/reset-session'");
html = html.replace("fetch('/api/test-chat/recent-bookings'", "fetch(BASE_URL + '/api/test-chat/recent-bookings'");

fs.writeFileSync('public/chat.html', html, 'utf8');
console.log('✅ Updated public/chat.html with BASE_URL & gemini-3.1-flash-lite!');
