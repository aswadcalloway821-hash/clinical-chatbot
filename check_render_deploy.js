(async () => {
  for (let i = 1; i <= 10; i++) {
    try {
      const res = await fetch('https://clinical-chatbot-4uof.onrender.com/test-chat');
      const text = await res.text();
      const updated = text.includes('gemini-3.1-flash-lite');
      console.log(`Check ${i}/10 [${new Date().toLocaleTimeString()}]: Live Render updated? -> ${updated}`);
      if (updated) {
        console.log('🎉 RENDER DEPLOYMENT IS LIVE AND ONLINE!');
        break;
      }
    } catch (e) {
      console.log(`Check ${i} error:`, e.message);
    }
    await new Promise(r => setTimeout(r, 10000));
  }
})();
