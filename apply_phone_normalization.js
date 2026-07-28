const fs = require('fs');

// 1. Update webhook.routes.ts to use resolveClinicId and phone normalization
const webhookCode = `import { Router } from 'express';
import { whatsAppService } from '../services/whatsapp.service';
import { bookingService } from '../services/booking.service';

const router = Router();

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
      const rawPhone = message?.from;
      const textBody = message?.text?.body;

      console.log(\`💬 Incoming WhatsApp Message from [\${rawPhone}]: "\${textBody}"\`);

      // دقة تحديد العيادة بناءً على رقم القناة وحساب المريض
      const resolvedClinic = await bookingService.resolveClinicId(rawPhone);

      // معالجة الرسالة عبر خدمة الحجز وتأكيد الشواغر بـ Supabase
      const replyMessage = await bookingService.processIncomingWhatsAppMessage(
        resolvedClinic.clinic_id,
        rawPhone,
        textBody
      );

      // إرسال الاستجابة الصادرة حياً لصفحة الواتساب الخاصة بالمريض
      await whatsAppService.sendTextMessage(rawPhone, replyMessage);
    }

    return res.status(200).send('EVENT_RECEIVED');
  } catch (error: any) {
    console.error('❌ Error handling WhatsApp Webhook:', error.message);
    return res.status(200).send('EVENT_RECEIVED');
  }
});

export default router;
`;

fs.writeFileSync('src/routes/webhook.routes.ts', webhookCode, 'utf8');
console.log('Successfully updated src/routes/webhook.routes.ts!');
