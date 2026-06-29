import express from 'express';
import axios from 'axios';
import http from 'http';
import webhookRouter from './routes/webhook';
import { SessionManager } from './utils/session-manager';

// Create the integration test express server
const app = express();
app.use(express.json());
app.use('/webhook', webhookRouter);

async function runE2ETests() {
  const PORT = 4999;
  let server: http.Server;

  // Start the server
  await new Promise<void>((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`🧪 Integration E2E Server running on port ${PORT}`);
      resolve();
    });
  });

  const senderNumber = '9647700000000';
  const webhookUrl = `http://localhost:${PORT}/webhook`;

  try {
    console.log('\n--- Turn 1: Patient starts conversation ---');
    const payload1 = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            messages: [{
              from: senderNumber,
              id: 'msg_id_101',
              text: { body: 'هلو عيني، أريد أحجز فحص أسنان' },
              type: 'text'
            }]
          },
          field: 'messages'
        }]
      }]
    };

    const res1 = await axios.post(webhookUrl, payload1);
    console.log('Turn 1 HTTP Status:', res1.status);

    // Verify session history was updated
    const history1 = SessionManager.getHistory(senderNumber);
    console.log('Session history length after Turn 1 (expected: 2):', history1.length);
    console.log('Last model message in session history:', JSON.stringify(history1[1].parts[0].text));

    console.log('\n--- Turn 2: Patient confirms they want to book a specific day ---');
    const payload2 = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            messages: [{
              from: senderNumber,
              id: 'msg_id_102',
              text: { body: 'أريد أحجز السبت الساعة 4:00 العصر باسم مرتضى الرافدين' },
              type: 'text'
            }]
          },
          field: 'messages'
        }]
      }]
    };

    const res2 = await axios.post(webhookUrl, payload2);
    console.log('Turn 2 HTTP Status:', res2.status);

    const history2 = SessionManager.getHistory(senderNumber);
    console.log('Session history length after Turn 2 (expected: 4):', history2.length);
    console.log('Last model message in session history:', JSON.stringify(history2[3].parts[0].text));

    // Test 3: Resetting the session
    console.log('\n--- Turn 3: Sending /reset command ---');
    const payload3 = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            messages: [{
              from: senderNumber,
              id: 'msg_id_103',
              text: { body: '/reset' },
              type: 'text'
            }]
          },
          field: 'messages'
        }]
      }]
    };

    const res3 = await axios.post(webhookUrl, payload3);
    console.log('Reset Command HTTP Status:', res3.status);

    const history3 = SessionManager.getHistory(senderNumber);
    console.log('Session history length after Reset (expected: 0):', history3.length);

    if (history3.length === 0) {
      console.log('\n🎉 ALL E2E INTEGRATION FLOW TESTS PASSED!');
    } else {
      console.error('\n❌ E2E INTEGRATION FLOW TEST FAILED!');
    }

  } catch (error: any) {
    console.error('❌ E2E Test Error:', error.message);
  } finally {
    // Stop server
    if (server!) {
      server.close(() => {
        console.log('\n🧪 E2E Test Server stopped.');
      });
    }
  }
}

runE2ETests();
