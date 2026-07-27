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

export interface ClinicContext {
  clinic_name: string;
  branches: Array<{ id: string; name: string }>;
  doctors: Array<{ id: string; name: string; title?: string }>;
  services: Array<{ id: string; name: string; price?: number }>;
  offerings: Array<{ id: string; doctor_id: string; service_id: string; branch_id: string }>;
}

export class BookingService {
  /**
   * 0️⃣ حاقن بيانات العيادة الحقيقي لمنع الهلوسة (Zero-Hallucination Context Injector)
   */
  async getClinicContext(clinicId: string): Promise<ClinicContext> {
    try {
      const { data: clinic } = await supabase
        .from('clinics')
        .select('id, name')
        .eq('id', clinicId)
        .maybeSingle();

      const { data: branches } = await supabase
        .from('branches')
        .select('id, name')
        .eq('clinic_id', clinicId);

      const { data: doctors } = await supabase
        .from('doctors')
        .select('id, name, title')
        .eq('clinic_id', clinicId);

      const { data: services } = await supabase
        .from('services')
        .select('id, name, price')
        .eq('clinic_id', clinicId);

      const { data: offerings } = await supabase
        .from('clinic_offerings')
        .select('id, doctor_id, service_id, branch_id')
        .eq('clinic_id', clinicId);

      return {
        clinic_name: clinic?.name || 'عيادة د علي التخصصية',
        branches: (branches || []).map((b) => ({ id: b.id, name: b.name })),
        doctors: (doctors || []).map((d) => ({ id: d.id, name: (d.name || '').replace(/[\.*#@$]/g, ''), title: d.title })),
        services: (services || []).map((s) => ({ id: s.id, name: (s.name || '').replace(/[\.*#@$]/g, ''), price: s.price })),
        offerings: (offerings || []).map((o) => ({
          id: o.id,
          doctor_id: o.doctor_id,
          service_id: o.service_id,
          branch_id: o.branch_id,
        })),
      };
    } catch (err: any) {
      console.warn('⚠️ Context Injector fallback triggered:', err.message);
      return {
        clinic_name: 'عيادة د علي التخصصية',
        branches: [{ id: '33333333-1111-1111-1111-111111111111', name: 'الفرع الرئيسي العشار' }],
        doctors: [{ id: '55555555-1111-1111-1111-111111111111', name: 'د علي الحسان' }],
        services: [{ id: '66666666-1111-1111-1111-111111111111', name: 'كشفية باطنية عامة' }],
        offerings: [
          {
            id: '2e4ede71-8ff6-4597-8067-b9a74c36d0c4',
            doctor_id: '55555555-1111-1111-1111-111111111111',
            service_id: '66666666-1111-1111-1111-111111111111',
            branch_id: '33333333-1111-1111-1111-111111111111',
          },
        ],
      };
    }
  }

  /**
   * تحديث حالة المحادثة last_state في جدول patient_chat_sessions
   */
  async updateSessionState(sessionId: string, newState: string): Promise<void> {
    try {
      await supabase
        .from('patient_chat_sessions')
        .update({ last_state: newState, updated_at: new Date().toISOString() })
        .eq('id', sessionId);
    } catch (err: any) {
      console.warn('⚠️ Failed to update session state:', err.message);
    }
  }

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
      doctor_name: (row.doctor_name || 'د علي الحسان').replace(/[\.*#@$]/g, ''),
      service_name: (row.service_name || 'كشفية باطنية عامة').replace(/[\.*#@$]/g, ''),
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
      doctor_name: (row.doctor_name || '').replace(/[\.*#@$]/g, ''),
      service_name: (row.service_name || '').replace(/[\.*#@$]/g, ''),
      appointment_time: row.appointment_time || appointmentTime,
    };
  }

  /**
   * 4️⃣ محرك المرحلة 3: أنسنة النبرة العراقية البشرية وتصفير الإيموجيات والرموز 100%
   */
  async processIncomingWhatsAppMessage(
    clinicId: string,
    phone: string,
    text: string
  ): Promise<string> {
    const cleanText = (text || '').trim();

    // 1. جلب سياق العيادة وجلسة المريض
    const clinicCtx = await this.getClinicContext(clinicId);
    const session = await this.getOrCreatePatientSession(clinicId, phone, '');

    const activeOfferingId = clinicCtx.offerings?.[0]?.id || '2e4ede71-8ff6-4597-8067-b9a74c36d0c4';
    const primaryDoctorName = clinicCtx.doctors?.[0]?.name || 'د علي الحسان';
    const primaryServiceName = clinicCtx.services?.[0]?.name || 'كشفية باطنية عامة';

    // 2. فحص الفروع إذا كان للعيادة أكثر من فرع
    if (clinicCtx.branches.length > 1 && !/فرع|عشار|مطيحة|بصرة|الرئيسي/i.test(cleanText) && session.last_state === 'INIT') {
      const branchNames = clinicCtx.branches.map((b) => b.name).join(' وفرع ');
      await this.updateSessionState(session.session_id, 'INIT');
      return `عيادتنا متوفرة بفرع ${branchNames} أي فرع يناسبك عيني حتى نشوفلك الأوقات الشاغرة`;
    }

    // 3. مطابقة اسم الدكتور عند التحديد الصريح
    let matchedDoctor = clinicCtx.doctors.find((d) => cleanText.includes(d.name) || cleanText.includes(d.name.replace('د ', '')));
    const selectedDoctorName = matchedDoctor?.name || primaryDoctorName;

    // 4. تحليل النيات
    const isBookingRequest = /حجز|موعد|أحجز|احجز|اريد|أريد|اسنان|أسنان|باطنية|طبيب|دكتور|جلسة|سلام|مرحبا/i.test(cleanText);
    const isConfirmation = /ثبت|تأكيد|اوكي|أوكي|تمام|اي|نعم|أكيد|ماشي/i.test(cleanText);
    const words = cleanText.split(/\s+/).filter(Boolean);
    const isFullName = words.length >= 2 && !isBookingRequest && !isConfirmation;

    // حالة A: المريض كتب "أوكي" أو "تمام" أو "ثبت" لكن لم يكتب اسمه بعد
    if (isConfirmation && !isFullName && !session.patient_name) {
      await this.updateSessionState(session.session_id, 'SLOT_PROPOSED');
      return 'تدلل عيني اكتبلي اسمك الثنائي حتى نثبت الموعد ونطيك كود الحجز';
    }

    // حالة B: المريض أدخل اسمه أو أكد الحجز بالكامل (الانتقال لـ CONFIRMED)
    if (isFullName || (isConfirmation && session.patient_name) || (session.last_state === 'SLOT_PROPOSED' && isFullName)) {
      const patientName = isFullName ? cleanText : session.patient_name;

      try {
        let slot = await this.getNearestAvailableSlot(clinicId, undefined, undefined, undefined, undefined, 2);

        let booking: BookingResult;
        try {
          booking = await this.createAppointmentBooking(
            clinicId,
            session.patient_id,
            session.session_id,
            activeOfferingId,
            slot.slot_time
          );
        } catch (bookingError: any) {
          // 1️⃣ اقتراح الموعد التالي تلقائياً عند تضارب الوقت
          slot = await this.getNearestAvailableSlot(clinicId, undefined, undefined, undefined, undefined, 3);
          booking = await this.createAppointmentBooking(
            clinicId,
            session.patient_id,
            session.session_id,
            activeOfferingId,
            slot.slot_time
          );
        }

        // تحديث حالة الجلسة إلى CONFIRMED
        await this.updateSessionState(session.session_id, 'CONFIRMED');

        const dateFormatted = new Date(booking.appointment_time).toLocaleString('ar-IQ', {
          weekday: 'long',
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        // رد بشري نقي 100% بدون أي إيموجي أو نجمة أو علامة تنقيط
        return `تدلل عيني تم تثبيت حجزك كود الحجز ${booking.booking_code} باسم ${patientName} عند ${selectedDoctorName} موعدك ${dateFormatted} ننتظرك بالعيادة`;
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

    // حالة C: استفسار عن موعد جديد أو طبيب معين (الانتقال لـ SLOT_PROPOSED)
    try {
      const slot = await this.getNearestAvailableSlot(clinicId, undefined, undefined, undefined, undefined, 2);
      const formattedDate = new Date(slot.slot_time).toLocaleString('ar-IQ', {
        weekday: 'long',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      // تحديث حالة الجلسة إلى SLOT_PROPOSED
      await this.updateSessionState(session.session_id, 'SLOT_PROPOSED');

      // رد بشري مقتضب وخالي تماماً من الإيموجيات والماركدوان
      return `اهلاً بك عيني أقرب موعد متاح لـ ${slot.service_name || primaryServiceName} مع ${selectedDoctorName} هو ${formattedDate} إذا حاب تثبته دزلي اسمك الثنائي`;
    } catch (err: any) {
      return `اهلاً بك عيني دزلي اسمك المباشر وشحابه تحجز حتى اساعدك فوراً`;
    }
  }
}

export const bookingService = new BookingService();
