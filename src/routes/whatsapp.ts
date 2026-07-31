import { Router, Request, Response } from 'express';
import { FsmStateManager } from '../fsm/state-manager.js';
import { GoogleSheetsService } from '../services/google-sheets.js';

const router = Router();

/**
 * WhatsApp Webhook Verification
 */
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'sara_digital_clinic_verify_secret_2026';

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
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];

      if (message && message.type === 'text') {
        const fromPhone = String(message.from).replace(/[^\d]/g, '');
        const rawText = String(message.text.body || '').trim().substring(0, 1000); // Sanitize and cap length

        if (fromPhone && rawText) {
          const tenant = await GoogleSheetsService.getTenantConfig();
          const replyText = await FsmStateManager.processMessage(fromPhone, rawText, tenant);

          console.log(`[WhatsApp Production Bot] Responding to ${fromPhone}`);

          // Send real WhatsApp message back via Meta Cloud API
          await sendWhatsAppCloudMessage(fromPhone, replyText);
        }
      }

      return res.status(200).json({ status: 'success' });
    }

    return res.sendStatus(404);
  } catch (error) {
    console.error('[WhatsApp Webhook Error]:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Local Simulator / Test API Endpoint
 */
router.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { phone = '07700000000', message = 'مرحبا' } = req.body;
    const tenant = await GoogleSheetsService.getTenantConfig();
    
    const replyText = await FsmStateManager.processMessage(phone, message, tenant);
    
    return res.json({
      phone,
      userMessage: message,
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
