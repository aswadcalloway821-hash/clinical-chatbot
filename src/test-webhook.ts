import http from 'http';

function makeRequest(options: http.RequestOptions, postData?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, data: body });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function testWebhookRoutes() {
  console.log('🧪 Testing Meta WhatsApp Webhook Verification & Message Route...\n');

  // 1️⃣ Test 1: Valid Verification Request from Meta
  console.log('1️⃣ Testing GET /api/webhook/whatsapp (Valid Token)...');
  const validVerification = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=sijil_secret_token_2026&hub.challenge=115820120',
    method: 'GET',
  });
  console.log('Result:', validVerification.statusCode, 'Body:', validVerification.data, '\n');

  // 2️⃣ Test 2: Invalid Token Verification Request
  console.log('2️⃣ Testing GET /api/webhook/whatsapp (Invalid Token)...');
  const invalidVerification = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=115820120',
    method: 'GET',
  });
  console.log('Result:', invalidVerification.statusCode, 'Body:', invalidVerification.data, '\n');

  // 3️⃣ Test 3: Incoming Message Payload POST from Meta
  console.log('3️⃣ Testing POST /api/webhook/whatsapp (Incoming Patient Message)...');
  const sampleMetaPayload = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: '9647701234567',
                  text: { body: 'السلام عليكم أريد أحجز موعد فحص باطنية' },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const postRes = await makeRequest(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/webhook/whatsapp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(sampleMetaPayload),
      },
    },
    sampleMetaPayload
  );

  console.log('Result:', postRes.statusCode, 'Body:', postRes.data, '\n');
}

testWebhookRoutes().catch(console.error);
