import { Router } from 'express';
import { whatsAppService } from '../services/whatsapp.service';

const router = Router();

/**
 * 1️⃣ مسار التحقق من Meta (GET /api/webhook/whatsapp)
 * تستدعيه شركة Meta للتحقق من ملكية الـ Webhook عند ربط التطبيق
 */
router.get('/whatsapp', (req: any, res: any) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN || 'sijil_secret_token_2026';

  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('✅ Meta Webhook Verification Successful!');
      return res.status(200).send(challenge);
    } else {
      console.warn('❌ Meta Webhook Verification Failed: Invalid verify token.');
      return res.sendStatus(403);
    }
  }

  return res.sendStatus(400);
});

/**
 * 2️⃣ مسار استقبال رسائل المرضى والرد التلقائي (POST /api/webhook/whatsapp)
 * يستقبل رسائل المرضى الصادرة حياً من الواتساب ويرسل الرد التلقائي
 */
router.post('/whatsapp', async (req: any, res: any) => {
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message) {
      const fromPhone = message?.from;
      const textBody = message?.text?.body;

      console.log(`💬 Incoming WhatsApp Message from [${fromPhone}]: "${textBody}"`);

      // إرسال الرد التلقائي الصادر عبر Meta Cloud API
      await whatsAppService.sendTextMessage(
        fromPhone,
        `أهلاً بك في عيادة سجل الطبي 🏥! تم استلام رسالتك: "${textBody}" وسنقوم بتأكيد حجزك فوراً.`
      );
    }

    // إرجاع استجابة فورية 200 OK لـ Meta خلال أقل من 3 ثوانٍ
    return res.status(200).send('EVENT_RECEIVED');
  } catch (error: any) {
    console.error('❌ Error handling WhatsApp Webhook:', error.message);
    return res.status(200).send('EVENT_RECEIVED');
  }
});

export default router;
