async function testRenderUrl() {
  const renderUrl = 'https://clinical-chatbot-4uof.onrender.com/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=sijil_secret_token_2026&hub.challenge=115820120';
  
  console.log('📡 Testing Render Live URL:', renderUrl);

  try {
    const res = await fetch(renderUrl);
    const text = await res.text();
    console.log('Status:', res.status, 'Response Text:', text);
  } catch (err: any) {
    console.error('Fetch error:', err.message);
  }
}

testRenderUrl();
