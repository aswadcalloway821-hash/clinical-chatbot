import { Router } from 'express';
import { whatsAppService } from '../services/whatsapp.service';
import { bookingService } from '../services/booking.service';

const router = Router();

// مسار استقبال Webhook الخاص بالواتساب
router.post('/webhook/whatsapp', async (req: any, res: any) => {
  try {
    await whatsAppService.handleIncomingMessage(req.body);
    res.status(200).json({ status: 'success' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// مسار إنشاء جلسة ومريض جديد عبر Supabase RPC
router.post('/session', async (req: any, res: any) => {
  try {
    const { clinicId, phone, name } = req.body || {};
    const session = await bookingService.getOrCreatePatientSession(clinicId, phone, name);
    res.status(200).json({ status: 'success', data: session });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
