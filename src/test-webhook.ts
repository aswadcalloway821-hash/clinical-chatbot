import express from 'express';
import axios from 'axios';
import http from 'http';
import webhookRouter from './routes/webhook';

// Create a test Express application
const app = express();
app.use(express.json());
app.use('/webhook', webhookRouter);

async function runTests() {
  const PORT = 4567;
  let server: http.Server;

  // Start the server on a test port
  await new Promise<void>((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`🧪 Test server started on port ${PORT}`);
      resolve();
    });
  });

  try {
    console.log('\n--- Test 1: GET /webhook Verification ---');
    // Test successful verification
    const getVerifyUrl = `http://localhost:${PORT}/webhook?hub.mode=subscribe&hub.challenge=hello_meta&hub.verify_token=clinic_webhook_verify_token_2026`;
    const verifyResponse = await axios.get(getVerifyUrl);
    console.log('GET Status:', verifyResponse.status);
    console.log('GET Response body (expected: "hello_meta"):', verifyResponse.data);

    if (verifyResponse.data === 'hello_meta') {
      console.log('✅ GET Verification Test Passed!');
    } else {
      console.error('❌ GET Verification Test Failed!');
    }

    console.log('\n--- Test 2: POST /webhook Mock text message payload ---');
    // Test text message webhook reception
    const mockPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: '123456789',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550000000', phone_number_id: '123456' },
            contacts: [{ profile: { name: 'Murtadha' }, wa_id: '9647700000000' }],
            messages: [{
              from: '9647700000000',
              id: 'test_msg_id_111',
              timestamp: '1781827200',
              text: { body: 'هلو عيني، أريد أحجز فحص أسنان' },
              type: 'text'
            }]
          },
          field: 'messages'
        }]
      }]
    };

    // Note: This POST request will attempt to send a real WhatsApp reply using WhatsappService.sendTextMessage.
    // Since our meta tokens in .env are empty/mocked, the WhatsApp send API call inside the webhook controller
    // will fail and log an error, but the webhook handler should still return 200 OK to Meta.
    const postResponse = await axios.post(`http://localhost:${PORT}/webhook`, mockPayload);
    console.log('POST Status:', postResponse.status);

    if (postResponse.status === 200) {
      console.log('✅ POST Message Parsing Test Passed (returned 200)!');
    } else {
      console.error('❌ POST Message Parsing Test Failed!');
    }

  } catch (error: any) {
    console.error('❌ Integration Test Error:', error.message);
  } finally {
    // Shutdown test server
    if (server!) {
      server.close(() => {
        console.log('\n🧪 Test server shut down.');
      });
    }
  }
}

runTests();
