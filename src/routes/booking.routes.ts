import { Router, Request, Response } from 'express';
import { bookingService } from '../services/booking.service';

const router = Router();

const DEFAULT_CLINIC_ID = '11111111-1111-1111-1111-111111111111';

/**
 * 🧪 endpoint لـ Web Chat Simulator & Data Telemetry Inspector
 */
router.post('/api/test-chat/message', async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, text, clinic_id } = req.body;
    const patientPhone = phone || '07800000000';
    const messageText = text || 'سلام عليكم';
    const clinicId = clinic_id || DEFAULT_CLINIC_ID;

    const telemetry = await bookingService.processTestMessageWithTelemetry(clinicId, patientPhone, messageText);
    res.json({ success: true, telemetry });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/booking/available-slots
 */
router.get('/available-slots', async (req: Request, res: Response): Promise<void> => {
  try {
    const clinic_id = (req.query.clinic_id as string) || DEFAULT_CLINIC_ID;
    const branch_id = req.query.branch_id as string;
    const department_id = req.query.department_id as string;
    const service_id = req.query.service_id as string;
    const target_date = req.query.target_date as string;

    const slot = await bookingService.getNearestAvailableSlot(
      clinic_id,
      branch_id,
      department_id,
      service_id,
      target_date
    );

    res.json({ success: true, slot });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
