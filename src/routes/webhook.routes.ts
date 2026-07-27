import { Router } from 'express';
import { whatsAppService } from '../services/whatsapp.service';
import { bookingService } from '../services/booking.service';

const router = Router();
const DEFAULT_CLINIC_ID = '11111111-1111-1111-1111-111111111111'; // عيادة د. علي التخصصية

/**
 * 1️⃣ مسار التحقق من Meta (GET /api/webhook/whatsapp)
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
 * 2️⃣ مسار استقبال رسائل المرضى والرد التلقائي والحجز الآلي (POST /api/webhook/whatsapp)
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

      // معالجة الرسالة وحسب نية المريض عبر خدمة الحجز الآلية
      const replyMessage = await bookingService.processIncomingWhatsAppMessage(
        DEFAULT_CLINIC_ID,
        fromPhone,
        textBody
      );

      // إرسال الاستجابة الصادرة حياً لصفحة الواتساب الخاصة بالمريض
      await whatsAppService.sendTextMessage(fromPhone, replyMessage);
    }

    // إرجاع استجابة فورية 200 OK لـ Meta خلال أقل من 3 ثوانٍ
    return res.status(200).send('EVENT_RECEIVED');
  } catch (error: any) {
    console.error('❌ Error handling WhatsApp Webhook:', error.message);
    return res.status(200).send('EVENT_RECEIVED');
  }
});

export default router;
