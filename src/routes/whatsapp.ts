import { Router, Request, Response } from 'express';
import { FsmStateManager } from '../fsm/state-manager.js';
import { GoogleSheetsService } from '../services/google-sheets.js';

const router = Router();

// 1. Deduplication Set for message.id (wamid) to prevent double processing on Meta retries
const processedMessageIds = new Set<string>();

// Clean old message IDs to keep memory footprint capped at 5000 max entries
setInterval(() => {
  if (processedMessageIds.size > 5000) {
    const idsArray = Array.from(processedMessageIds);
    // Keep last 2500 entries
    processedMessageIds.clear();
    idsArray.slice(-2500).forEach(id => processedMessageIds.add(id));
  }
}, 15 * 60 * 1000);

// 2. Multi-Message Debounce Buffer (2.5 seconds) per phone number
interface UserMessageBuffer {
  messages: string[];
  timer: NodeJS.Timeout;
}
const userBuffers = new Map<string, UserMessageBuffer>();

/**
 * WhatsApp Webhook Verification
 */
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'clinic_webhook_verify_token_2026';

  if (mode && token === VERIFY_TOKEN) {
    console.log('[WhatsApp Webhook] Verified successfully!');
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

/**
 * Receive Incoming WhatsApp Messages
 */
router.post('/webhook', (req: Request, res: Response) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      // MECHANISM 1: Immediate ACK (HTTP 200 OK within 5ms to Meta)
      res.status(200).json({ status: 'success' });

      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];

      if (message && message.type === 'text') {
        const messageId = message.id;
        const fromPhone = message.from;
        // Security & Memory Hardening: Cap incoming message length to 1000 chars
        const rawText = message.text.body || '';
        const messageText = rawText.length > 1000 ? rawText.substring(0, 1000) : rawText;

        // MECHANISM 2: Deduplication Set check
        if (processedMessageIds.has(messageId)) {
          console.log(`[Webhook Deduplication] Ignored duplicate message ID: ${messageId}`);
          return;
        }
        processedMessageIds.add(messageId);

        // MECHANISM 3: 2.5s Multi-Message Debounce Buffer
        enqueueMessageForProcessing(fromPhone, messageText);
      }
      return;
    }

    return res.sendStatus(404);
  } catch (error) {
    console.error('[WhatsApp Webhook Error]:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

/**
 * Debounce Buffer Worker: Collects consecutive messages sent within 2.5 seconds
 */
function enqueueMessageForProcessing(fromPhone: string, messageText: string) {
  const DEBOUNCE_TIME_MS = 5000; // 5 seconds debounce buffer

  const existingBuffer = userBuffers.get(fromPhone);

  if (existingBuffer) {
    clearTimeout(existingBuffer.timer);
    existingBuffer.messages.push(messageText);

    existingBuffer.timer = setTimeout(async () => {
      // 1. Extract messages & delete buffer immediately BEFORE starting async processing
      const messagesToProcess = [...existingBuffer.messages];
      userBuffers.delete(fromPhone);

      await processAggregatedUserMessages(fromPhone, messagesToProcess);
    }, DEBOUNCE_TIME_MS);

    console.log(`[Debounce Buffer] Appended message from ${fromPhone}. Buffer size: ${existingBuffer.messages.length}`);
  } else {
    const newBuffer: UserMessageBuffer = {
      messages: [messageText],
      timer: setTimeout(async () => {
        // 1. Extract messages & delete buffer immediately BEFORE starting async processing
        const messagesToProcess = [...newBuffer.messages];
        userBuffers.delete(fromPhone);

        await processAggregatedUserMessages(fromPhone, messagesToProcess);
      }, DEBOUNCE_TIME_MS)
    };
    userBuffers.set(fromPhone, newBuffer);
    console.log(`[Debounce Buffer] Started 2.5s timer for ${fromPhone}`);
  }
}

/**
 * Process Aggregated Messages with FSM & Gemini Engine
 */
async function processAggregatedUserMessages(fromPhone: string, messages: string[]) {
  const combinedText = messages.join(' ');
  console.log(`[Processing Aggregated Messages for ${fromPhone}]: "${combinedText}"`);

  try {
    const tenant = await GoogleSheetsService.getTenantConfig();
    const replyText = await FsmStateManager.processMessage(fromPhone, combinedText, tenant);

    console.log(`[WhatsApp Bot Reply to ${fromPhone}]: ${replyText}`);
    await sendWhatsAppCloudMessage(fromPhone, replyText);
  } catch (error: any) {
    // Developer Error Alerting & Patient Holding Response
    console.error(`🚨 [DEVELOPER ALERT - CRITICAL ERROR ON PHONE ${fromPhone}]:`, error?.stack || error);
    const patientHoldingMessage = 'العفو، ممكن تنتظرني دقائق وارجع ارد عليك؟';
    await sendWhatsAppCloudMessage(fromPhone, patientHoldingMessage);
  }
}

/**
 * Debug Endpoint to inspect live tenant config on Render
 */
router.get('/api/tenant-debug', async (req: Request, res: Response) => {
  try {
    const tenant = await GoogleSheetsService.getTenantConfig();
    return res.json({ status: 'ok', tenant });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || err });
  }
});

/**
 * Local Simulator / Test API Endpoint
 */
router.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { phone = '07700000000', message = 'مرحبا' } = req.body;
    const rawText = String(message || '');
    const cleanText = rawText.length > 1000 ? rawText.substring(0, 1000) : rawText;

    const tenant = await GoogleSheetsService.getTenantConfig();
    const replyText = await FsmStateManager.processMessage(phone, cleanText, tenant);
    
    return res.json({
      phone,
      userMessage: cleanText,
      botReply: replyText
    });
  } catch (error) {
    console.error('[Chat API Error]:', error);
    return res.status(500).json({ error: 'Server Error' });
  }
});

/**
 * Helper to send text message via Meta WhatsApp Cloud API
 */
async function sendWhatsAppCloudMessage(toPhone: string, text: string): Promise<boolean> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneId || !token) {
    console.warn('[WhatsApp Cloud API Warning] Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN');
    return false;
  }

  try {
    const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone,
        type: 'text',
        text: { preview_url: false, body: text }
      })
    });

    const resData = await response.json();
    if (response.ok) {
      console.log(`[WhatsApp Cloud API Success] Message sent to ${toPhone}`);
      return true;
    } else {
      console.error('[WhatsApp Cloud API Error]:', resData);
      return false;
    }
  } catch (err) {
    console.error('[WhatsApp Cloud API Exception]:', err);
    return false;
  }
}

export default router;
