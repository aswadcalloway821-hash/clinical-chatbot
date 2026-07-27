import { Router } from 'express';
import { bookingService } from '../services/booking.service';

const router = Router();

/**
 * 🔹 المسار الأول: إنشاء / جلب جلسة المريض
 * POST /api/bookings/session
 */
router.post('/session', async (req: any, res: any) => {
  try {
    const { clinic_id, patient_phone, patient_name } = req.body || {};

    if (!clinic_id || !patient_phone || !patient_name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const session = await bookingService.getOrCreatePatientSession(
      clinic_id,
      patient_phone,
      patient_name
    );

    return res.status(200).json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 🔹 المسار الثاني: الاستعلام عن أقرب موعد شاغر
 * GET /api/bookings/slots
 */
router.get('/slots', async (req: any, res: any) => {
  try {
    const { clinic_id, branch_id, department_id, service_id, target_date } = req.query || {};

    if (!clinic_id || !branch_id || !department_id || !service_id || !target_date) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameters',
      });
    }

    const slots = await bookingService.getNearestAvailableSlot(
      clinic_id as string,
      branch_id as string,
      department_id as string,
      service_id as string,
      target_date as string
    );

    return res.status(200).json({
      success: true,
      data: slots,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 🔹 المسار الثالث: تنفيذ الحجز الصريح والذري
 * POST /api/bookings/create
 */
router.post('/create', async (req: any, res: any) => {
  try {
    const {
      clinic_id,
      patient_id,
      session_id,
      clinic_offering_id,
      appointment_time,
    } = req.body || {};

    if (
      !clinic_id ||
      !patient_id ||
      !session_id ||
      !clinic_offering_id ||
      !appointment_time
    ) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const booking = await bookingService.createAppointmentBooking(
      clinic_id,
      patient_id,
      session_id,
      clinic_offering_id,
      appointment_time
    );

    return res.status(201).json({
      success: true,
      data: booking,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
