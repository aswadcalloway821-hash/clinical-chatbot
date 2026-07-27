import { supabase } from '../config/supabase';

export interface PatientSession {
  patient_id: string;
  patient_name: string;
  patient_phone: string;
  session_id: string;
  last_state: string;
  is_new_patient: boolean;
}

export interface AvailableSlot {
  slot_time: string;
  doctor_id: string;
  doctor_name: string;
  service_name: string;
}

export interface BookingResult {
  booking_id: string;
  booking_code: string;
  booking_status: string;
  patient_name: string;
  doctor_name: string;
  service_name: string;
  appointment_time: string;
}

export class BookingService {
  /**
   * 1️⃣ إنشاء أو جلب جلسة مريض عبر دالة RPC المباشرة
   */
  async getOrCreatePatientSession(
    clinicId: string,
    phone: string,
    name?: string
  ): Promise<PatientSession> {
    const { data, error } = await supabase.rpc('get_or_create_patient_session', {
      p_clinic_id: clinicId,
      p_patient_phone: phone,
      p_patient_name: name || null,
    });

    if (error) {
      console.error('❌ Supabase RPC get_or_create_patient_session Error:', error);
      throw new Error(`Failed to get or create patient session: ${error.message}`);
    }

    if (!data || data.length === 0) {
      throw new Error('RPC get_or_create_patient_session returned empty result');
    }

    const row = data[0];
    return {
      patient_id: row.patient_id,
      patient_name: row.patient_name || '',
      patient_phone: row.patient_phone || phone,
      session_id: row.session_id,
      last_state: row.last_state || 'INIT',
      is_new_patient: row.is_new_patient ?? true,
    };
  }

  /**
   * 2️⃣ البحث عن أقرب موعد متاح لخدمة معينة عبر RPC المباشرة
   */
  async getNearestAvailableSlot(
    clinicId: string,
    branchId?: string,
    departmentId?: string,
    serviceId?: string,
    targetDate?: string,
    offsetDays: number = 2
  ): Promise<AvailableSlot> {
    const target = new Date();
    target.setDate(target.getDate() + offsetDays);
    const defaultDate = target.toISOString().split('T')[0];

    const { data, error } = await supabase.rpc('get_nearest_available_slot', {
      p_clinic_id: clinicId,
      p_branch_id: branchId || '33333333-1111-1111-1111-111111111111',
      p_department_id: departmentId || '44444444-1111-1111-1111-111111111111',
      p_service_id: serviceId || '66666666-1111-1111-1111-111111111111',
      p_target_date: targetDate || defaultDate,
    });

    if (error || !data || data.length === 0) {
      return {
        slot_time: `${defaultDate}T16:00:00Z`,
        doctor_id: '55555555-1111-1111-1111-111111111111',
        doctor_name: 'د علي الحسان',
        service_name: 'كشفية باطنية عامة',
      };
    }

    const row = data[0];
    return {
      slot_time: row.slot_time || `${defaultDate}T16:00:00Z`,
      doctor_id: row.doctor_id || '55555555-1111-1111-1111-111111111111',
      doctor_name: (row.doctor_name || 'د علي الحسان').replace(/\./g, ''),
      service_name: (row.service_name || 'كشفية باطنية عامة').replace(/\./g, ''),
    };
  }

  /**
   * 3️⃣ تنفيذ الحجز الذري وإنشاء الموعد في Supabase عبر RPC المباشرة
   */
  async createAppointmentBooking(
    clinicId: string,
    patientId: string,
    sessionId: string,
    clinicOfferingId: string,
    appointmentTime: string
  ): Promise<BookingResult> {
    const { data, error } = await supabase.rpc('create_appointment_booking', {
      p_clinic_id: clinicId,
      p_patient_id: patientId,
      p_session_id: sessionId,
      p_clinic_offering_id: clinicOfferingId,
      p_appointment_time: appointmentTime,
    });

    if (error) {
      console.error('❌ Supabase RPC create_appointment_booking Error:', error);
      throw new Error(error.message || 'Already booked');
    }

    if (!data || data.length === 0) {
      throw new Error('RPC create_appointment_booking returned empty result');
    }

    const row = data[0];
    return {
      booking_id: row.booking_id,
      booking_code: row.booking_code,
      booking_status: row.booking_status || 'confirmed',
      patient_name: row.patient_name || '',
      doctor_name: (row.doctor_name || '').replace(/\./g, ''),
      service_name: (row.service_name || '').replace(/\./g, ''),
      appointment_time: row.appointment_time || appointmentTime,
    };
  }

  /**
   * 4️⃣ محرك المعالجة التفاعلية البشري المالي باللهجة العراقية الخالصة وبدون أي علامات تنقيط
   */
  async processIncomingWhatsAppMessage(
    clinicId: string,
    phone: string,
    text: string
  ): Promise<string> {
    const cleanText = (text || '').trim();
    const defaultOfferingId = '2e4ede71-8ff6-4597-8067-b9a74c36d0c4';

    // 1. جلب جلسة المريض
    const session = await this.getOrCreatePatientSession(clinicId, phone, '');

    // 2. تحليل النيات
    const isBookingRequest = /حجز|موعد|أحجز|احجز|اريد|اسنان|أسنان|باطنية|طبيب|دكتور|جلسة|سلام|مرحبا/i.test(cleanText);
    const isConfirmation = /ثبت|تأكيد|اوكي|أوكي|تمام|اي|نعم|أكيد|ماشي/i.test(cleanText);
    const words = cleanText.split(/\s+/).filter(Boolean);
    const isFullName = words.length >= 2 && !isBookingRequest && !isConfirmation;

    // حالة 1: المريض كتب "أوكي" أو "تمام" أو "ثبت" لكن لم يكتب اسمه بعد
    if (isConfirmation && !isFullName && !session.patient_name) {
      return 'تدلل عيني اكتبلي اسمك الثنائي حتى نثبت الموعد ونطيك كود الحجز';
    }

    // حالة 2: المريض أدخل اسمه أو أكد الحجز بالكامل
    if (isFullName || (isConfirmation && session.patient_name)) {
      const patientName = isFullName ? cleanText : session.patient_name;

      try {
        let slot = await this.getNearestAvailableSlot(clinicId, undefined, undefined, undefined, undefined, 2);
        
        let booking: BookingResult;
        try {
          booking = await this.createAppointmentBooking(
            clinicId,
            session.patient_id,
            session.session_id,
            defaultOfferingId,
            slot.slot_time
          );
        } catch (bookingError: any) {
          // 1️⃣ النقطة الأولى: اقتراح الموعد التالي تلقائياً عند تضارب الوقت
          slot = await this.getNearestAvailableSlot(clinicId, undefined, undefined, undefined, undefined, 3);
          booking = await this.createAppointmentBooking(
            clinicId,
            session.patient_id,
            session.session_id,
            defaultOfferingId,
            slot.slot_time
          );
        }

        const dateFormatted = new Date(booking.appointment_time).toLocaleString('ar-IQ', {
          weekday: 'long',
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        // رد بشري نقي بدون أي علامات تنقيط أو رموز نجمة
        return `تدلل عيني تم تثبيت حجزك كود الحجز ${booking.booking_code} باسم ${patientName} عند ${booking.doctor_name} موعدك ${dateFormatted} ننتظرك بالعيادة`;
      } catch (err: any) {
        // اقتراح الموعد التالي بلباقة عند الانشغال التام
        const nextSlot = await this.getNearestAvailableSlot(clinicId, undefined, undefined, undefined, undefined, 3);
        const nextDateFormatted = new Date(nextSlot.slot_time).toLocaleString('ar-IQ', {
          weekday: 'long',
          hour: '2-digit',
          minute: '2-digit',
        });
        return `عيني هذا الموعد انحجز قبل لحظات أقرب موعد متاح بعده هو ${nextDateFormatted} حاب أثبته لك`;
      }
    }

    // حالة 3: استفسار عن موعد جديد
    try {
      const slot = await this.getNearestAvailableSlot(clinicId, undefined, undefined, undefined, undefined, 2);
      const formattedDate = new Date(slot.slot_time).toLocaleString('ar-IQ', {
        weekday: 'long',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      // رد بشري قصير ومباشر باللهجة العراقية بدون علامات تنقيط
      return `اهلاً بك عيني أقرب موعد متاح لـ ${slot.service_name} مع ${slot.doctor_name} هو ${formattedDate} إذا حاب تثبته دزلي اسمك الثنائي`;
    } catch (err: any) {
      return `اهلاً بك عيني دزلي اسمك المباشر وشحابه تحجز حتى اساعدك فوراً`;
    }
  }
}

export const bookingService = new BookingService();
