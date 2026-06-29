import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { WhatsappService } from '../services/whatsapp.service';
import { GeminiService } from '../services/gemini.service';
import { SessionManager } from '../utils/session-manager';
import { TenantManager } from '../config/tenant-manager';

const router = Router();

const logDebug = (msg: string) => {
  try {
    const file = path.join(process.cwd(), 'debug.log');
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e: any) {
    console.error('❌ debug.log write error:', e.message);
  }
};

/**
 * GET /webhook
 * Endpoint for Meta Webhook verification. Meta calls this with challenge and token parameters
 * to verify the server is active and belongs to the configured developer.
 */
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'];

  logDebug(`GET /webhook query: ${JSON.stringify(req.query)}`);

  if (mode && token) {
    if (mode === 'subscribe') {
      const tenant = TenantManager.getTenantByVerifyToken(token);
      if (tenant || token === config.whatsapp.verifyToken) {
        console.log(`✅ Webhook verified successfully. Token matched.`);
        res.status(200).send(challenge);
        return;
      } else {
        console.error('❌ Webhook verification failed. Token mismatch.');
        res.sendStatus(403);
        return;
      }
    }
  }

  res.sendStatus(400);
});

/**
 * POST /webhook
 * Endpoint where Meta delivers real-time events (incoming messages, delivery statuses, etc.).
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    logDebug(`POST /webhook body: ${JSON.stringify(body)}`);
    console.log('📥 Incoming webhook payload:', JSON.stringify(body, null, 2));

    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (message) {
        const from = message.from; // Sender's phone number
        const messageType = message.type;
        const phoneNumberId = value?.metadata?.phone_number_id || config.whatsapp.phoneNumberId;

        // Resolve active tenant credentials
        const tenant = TenantManager.getTenant(phoneNumberId);
        const apiToken = tenant ? tenant.apiToken : config.whatsapp.apiToken;

        console.log(`💬 Message received from ${from} | Type: ${messageType} | Phone ID: ${phoneNumberId}`);

        // 1. Retrieve the patient's existing conversation history
        const history = SessionManager.getHistory(from);

        if (messageType === 'text') {
          const textBody = message.text?.body;
          console.log(`📝 Text message content: "${textBody}"`);

          // Special commands for testing/resetting
          if (textBody.trim().toLowerCase() === '/reset') {
            SessionManager.clearHistory(from);
            await WhatsappService.sendTextMessage(from, 'تم إعادة تعيين الجلسة بنجاح عيوني. شلون أكدر أساعدك اليوم؟', apiToken, phoneNumberId, message.id);
            res.sendStatus(200);
            return;
          }

          // 2. Feed the turn to Gemini (Gemini handles the tool loop dynamically)
          const { responseText, updatedHistory } = await GeminiService.handleChatTurn(phoneNumberId, from, textBody, history);

          // 3. Save the updated history
          SessionManager.saveHistory(from, updatedHistory);

          // 4. Send the response back to WhatsApp as a quoted reply
          await WhatsappService.sendTextMessage(from, responseText, apiToken, phoneNumberId, message.id);

        } else if (messageType === 'audio') {
          const audioId = message.audio?.id;
          
          if (audioId) {
            // 2. Download the voice note locally using tenant token
            const localPath = await WhatsappService.downloadVoiceNote(audioId, apiToken);

            if (localPath) {
              let responseText = '';
              let updatedHistory = history;

              // 3. Upload to Gemini File API if key exists, else handle mock
              const uploadResult = await GeminiService.uploadAudioFile(localPath, 'audio/ogg');

              if (uploadResult) {
                const messageInput = [
                  { text: 'هذه بصمة صوتية مسجلة من المراجع بصوته وعليك الإجابة عليها باختصار:' },
                  { fileData: { fileUri: uploadResult.uri, mimeType: uploadResult.mimeType } }
                ];

                const chatResult = await GeminiService.handleChatTurn(phoneNumberId, from, messageInput, history);
                responseText = chatResult.responseText;
                updatedHistory = chatResult.updatedHistory;
              } else {
                const mockText = 'أرسل المراجع بصمة صوتية.';
                const chatResult = await GeminiService.handleChatTurn(phoneNumberId, from, mockText, history);
                responseText = chatResult.responseText;
                updatedHistory = chatResult.updatedHistory;
              }

              // 4. Save history and reply as a quoted reply
              SessionManager.saveHistory(from, updatedHistory);
              await WhatsappService.sendTextMessage(from, responseText, apiToken, phoneNumberId, message.id);

              // 5. Clean up the downloaded local file
              try {
                fs.unlinkSync(localPath);
                console.log(`🗑️ Temporary file deleted: ${localPath}`);
              } catch (cleanupErr: any) {
                console.error('⚠️ Failed to delete temporary audio file:', cleanupErr.message);
              }
            } else {
              await WhatsappService.sendTextMessage(from, 'فدوة عيني، صار خطأ باستلام البصمة الصوتية. تكدر تكتبلي رسالة نصية؟', apiToken, phoneNumberId, message.id);
            }
          }
        } else {
          console.log(`⚠️ Unsupported message type: ${messageType}`);
          await WhatsappService.sendTextMessage(from, 'أهلاً عيني، حالياً أستقبل الرسائل النصية وبصمات الصوت فقط.', apiToken, phoneNumberId, message.id);
        }
      }

      res.sendStatus(200);
      return;
    }

    res.sendStatus(404);
  } catch (error: any) {
    console.error('❌ Error handling incoming Webhook:', error.message);
    res.sendStatus(500);
  }
});

export default router;
