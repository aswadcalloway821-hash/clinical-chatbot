async function testEndpoints() {
  const baseUrl = 'https://clinical-chatbot-4uof.onrender.com';
  
  const paths = [
    '/health',
    '/',
    '/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=sijil_secret_token_2026&hub.challenge=115820120',
    '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=sijil_secret_token_2026&hub.challenge=115820120'
  ];

  for (const path of paths) {
    try {
      const res = await fetch(baseUrl + path);
      const text = await res.text();
      console.log(`Path [${path}] -> Status: ${res.status}, Body: ${text.substring(0, 100)}`);
    } catch (err: any) {
      console.error(`Path [${path}] Error:`, err.message);
    }
  }
}

testEndpoints();
