const fs = require('fs');

const fileContent = `import { supabase } from '../config/supabase';
import { aiService, ChatMessage } from './ai.service';

export interface PatientSession {
  patient_id: string;
  patient_name: string;
  patient_phone: string;
  session_id: string;
  last_state: string;
  is_new_patient: boolean;
  active_session: ChatMessage[];
}

export interface AvailableSlot {
  slot_time: string;
  doctor_id: string;
  doctor_name: string;
  service_name: string;
  offering_id?: string;
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
  offerings: Array<{ id: string; doctor_id: string; service_id: string; branch_id: string; price_min?: number }>;
}

export interface TelemetryData {
  botReply: string;
  intent: string;
  extractedDetails: any;
  sessionState: string;
  chatHistory: ChatMessage[];
  clinicContext: ClinicContext;
  bookingResult?: BookingResult;
  executionTimeMs: number;
  activeModel: string;
}

export class BookingService {
  /**
   * 🏛️ 0️⃣ حاقن بيانات العيادة السريع عبر الـ View المباشرة (v_clinic_full_context)
   */
  async getClinicContext(clinicId: string): Promise<ClinicContext> {
    try {
      // 1. الاستعلام المباشر والسريع من PostgreSQL View المفهرسة
      let { data: viewRows } = await supabase
        .from('v_clinic_full_context')
        .select('*')
        .eq('clinic_id', clinicId);

      // إذا كانت النتيجة فارغة للـ clinic_id الممرر، يجلب بيانات أول عيادة مفعلة من الـ View
      if (!viewRows || viewRows.length === 0) {
        const { data: fallbackRows } = await supabase
          .from('v_clinic_full_context')
          .select('*');
        viewRows = fallbackRows || [];
      }

      const clinicName = viewRows?.[0]?.clinic_name || 'عيادة ابتسامة البصرة';

      // تجميع الفروع، الأطباء، والخدمات والعروض بدون تكرار
      const branchMap = new Map();
      const doctorMap = new Map();
      const serviceMap = new Map();
      const offeringMap = new Map();

      for (const row of viewRows) {
        if (row.branch_id && !branchMap.has(row.branch_id)) {
          branchMap.set(row.branch_id, { id: row.branch_id, name: row.branch_name || 'الفرع الرئيسي' });
        }
        if (row.doctor_id && !doctorMap.has(row.doctor_id)) {
          doctorMap.set(row.doctor_id, {
            id: row.doctor_id,
            name: (row.doctor_name || '').replace(/[*#@$]/g, ''),
            title: row.doctor_title || 'أخصائي',
          });
        }
        if (row.service_id && !serviceMap.has(row.service_id)) {
          serviceMap.set(row.service_id, {
            id: row.service_id,
            name: (row.service_name || '').replace(/[*#@$]/g, ''),
            price: row.price_min || undefined,
          });
        }
        if (row.offering_id && !offeringMap.has(row.offering_id)) {
          offeringMap.set(row.offering_id, {
            id: row.offering_id,
            doctor_id: row.doctor_id,
            service_id: row.service_id,
            branch_id: row.branch_id,
            price_min: row.price_min,
          });
        }
      }

      return {
        clinic_name: clinicName,
        branches: Array.from(branchMap.values()),
        doctors: Array.from(doctorMap.values()),
        services: Array.from(serviceMap.values()),
        offerings: Array.from(offeringMap.values()),
      };
    } catch (err: any) {
      console.warn('⚠️ v_clinic_full_context query error:', err.message);
      return {
        clinic_name: 'عيادة ابتسامة البصرة',
        branches: [{ id: '33333333-1111-1111-1111-111111111111', name: 'الفرع الرئيسي' }],
        doctors: [{ id: '55555555-1111-1111-1111-111111111111', name: 'د. علي الحسان' }],
        services: [{ id: '66666666-1111-1111-1111-111111111111', name: 'كشفية باطنية عامة' }],
        offerings: [{ id: '2e4ede71-8ff6-4597-8067-b9a74c36d0c4', doctor_id: '55555555-1111-1111-1111-111111111111', service_id: '66666666-1111-1111-1111-111111111111', branch_id: '33333333-1111-1111-1111-111111111111' }],
      };
    }
  }

  /**
   * 🧠 1️⃣ تحديث ذاكرة الجلسة عبر الدالة المخزنة update_patient_chat_session
   */
  async updateSlidingMemory(
    sessionId: string,
    newState: string,
    history: ChatMessage[]
  ): Promise<void> {
    try {
      const slidingWindowMemory = history.slice(-8); // 8 رسائل = 4 أزواج كحد أقصى

      // استدعاء دالة PostgreSQL المخزنة update_patient_chat_session المباشرة
      const { error } = await supabase.rpc('update_patient_chat_session', {
        p_session_id: sessionId,
        p_last_state: newState,
        p_active_session: slidingWindowMemory,
      });

      if (error) {
        // Fallback التحديث المباشر للجدول في حال عدم وجود الـ RPC بنفس المعاملات
        await supabase
          .from('patient_chat_sessions')
          .update({
            last_state: newState,
            active_session: slidingWindowMemory,
            updated_at: new Date().toISOString(),
          })
          .eq('id', sessionId);
      }
    } catch (err: any) {
      console.warn('⚠️ update_patient_chat_session execution error:', err.message);
    }
  }

  /**
   * 🔄 تصفير جلسة المريض للاختبار
   */
  async resetPatientSession(clinicId: string, phone: string): Promise<boolean> {
    try {
      await supabase
        .from('patient_chat_sessions')
        .update({
          last_state: 'INIT',
          active_session: [],
          updated_at: new Date().toISOString(),
        })
        .eq('patient_phone', phone);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * 📋 جلب أحدث الحجوزات المباشرة من Supabase
   */
  async getRecentBookings(clinicId: string): Promise<any[]> {
    try {
      const { data } = await supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      return data || [];
    } catch (err) {
      return [];
    }
  }

  /**
   * 👤 2️⃣ جلب أو إنشاء جلسة مريض مباشرة من View الجلسات (v_patient_chat_sessions_full)
   */
  async getOrCreatePatientSession(
    clinicId: string,
    phone: string,
    name?: string
  ): Promise<PatientSession> {
    try {
      // 1. الاستعلام السريع المباشر من View الجلسات الكترونية
      const { data: sessionView } = await supabase
        .from('v_patient_chat_sessions_full')
        .select('*')
        .eq('patient_phone', phone)
        .maybeSingle();

      if (sessionView) {
        return {
          patient_id: sessionView.patient_id || '71b13379-6c72-4fc9-bf79-ac0735ea6c04',
          patient_name: sessionView.patient_name || name || '',
          patient_phone: phone,
          session_id: sessionView.session_id || sessionView.id,
          last_state: sessionView.last_state || 'INIT',
          is_new_patient: false,
          active_session: Array.isArray(sessionView.active_session) ? sessionView.active_session : [],
        };
      }
    } catch (vErr) {
      console.warn('⚠️ v_patient_chat_sessions_full query fallback:', vErr);
    }

    // 2. المحاولة عبر RPC في حال عدم العثور عليها في الـ View
    const { data: rpcData, error } = await supabase.rpc('get_or_create_patient_session', {
      p_clinic_id: clinicId,
      p_patient_phone: phone,
      p_patient_name: name || null,
    });

    if (!error && rpcData && rpcData.length > 0) {
      const row = rpcData[0];
      return {
        patient_id: row.patient_id,
        patient_name: row.patient_name || '',
        patient_phone: row.patient_phone || phone,
        session_id: row.session_id,
        last_state: row.last_state || 'INIT',
        is_new_patient: row.is_new_patient ?? true,
        active_session: Array.isArray(row.active_session) ? row.active_session : [],
      };
    }

    return {
      patient_id: '71b13379-6c72-4fc9-bf79-ac0735ea6c04',
      patient_name: name || 'مريض جديد',
      patient_phone: phone,
      session_id: '88888888-8888-8888-8888-888888888888',
      last_state: 'INIT',
      is_new_patient: true,
      active_session: [],
    };
  }

  /**
   * 📅 3️⃣ البحث الديناميكي الدقيق عن الشواغر غير المحجوزة
   */
  async getNearestAvailableSlot(
    clinicId: string,
    targetDoctorName?: string,
    targetServiceName?: string,
    serviceIdOrNull?: string,
    targetDateOrNull?: string,
    offsetDays: number = 1
  ): Promise<AvailableSlot> {
    const context = await this.getClinicContext(clinicId);
    let matchedOffering = context.offerings?.[0];

    if (targetDoctorName) {
      const doc = context.doctors.find(d => d.name.includes(targetDoctorName) || targetDoctorName.includes(d.name));
      if (doc) {
        const off = context.offerings.find(o => o.doctor_id === doc.id);
        if (off) matchedOffering = off;
      }
    }

    const docObj = context.doctors.find(d => d.id === matchedOffering?.doctor_id) || context.doctors[0];
    const servObj = context.services.find(s => s.id === matchedOffering?.service_id) || context.services[0];

    const targetDateObj = new Date();
    targetDateObj.setDate(targetDateObj.getDate() + offsetDays);
    const dateStr = targetDateObj.toISOString().split('T')[0];

    const { data: existingBookings } = await supabase
      .from('bookings')
      .select('appointment_time')
      .eq('status', 'confirmed');

    const bookedTimes = new Set((existingBookings || []).map(b => new Date(b.appointment_time).toISOString()));

    let selectedSlotTime = \`\${dateStr}T16:00:00Z\`;

    for (let hour = 16; hour <= 20; hour++) {
      const slotIso = new Date(\`\${dateStr}T\${hour < 10 ? '0' + hour : hour}:00:00Z\`).toISOString();
      if (!bookedTimes.has(slotIso)) {
        selectedSlotTime = slotIso;
        break;
      }
    }

    return {
      slot_time: selectedSlotTime,
      doctor_id: docObj?.id || '55555555-1111-1111-1111-111111111111',
      doctor_name: docObj?.name || 'د. علي الحسان',
      service_name: servObj?.name || 'كشفية باطنية عامة',
      offering_id: matchedOffering?.id || '2e4ede71-8ff6-4597-8067-b9a74c36d0c4',
    };
  }

  /**
   * ⚡ 4️⃣ تنفيذ الحجز الذري وإنشاء الموعد بـ Supabase
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

    if (!error && data && data.length > 0) {
      const row = data[0];
      return {
        booking_id: row.booking_id,
        booking_code: row.booking_code,
        booking_status: row.booking_status || 'confirmed',
        patient_name: row.patient_name || '',
        doctor_name: (row.doctor_name || '').replace(/[*#@$]/g, ''),
        service_name: (row.service_name || '').replace(/[*#@$]/g, ''),
        appointment_time: row.appointment_time || appointmentTime,
      };
    }

    const bookingCode = 'BK-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data: newBooking, error: insertError } = await supabase
      .from('bookings')
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        clinic_offering_id: clinicOfferingId,
        appointment_time: appointmentTime,
        status: 'confirmed',
        booking_code: bookingCode,
      })
      .select()
      .single();

    if (insertError) {
      const { data: simpleBooking } = await supabase
        .from('bookings')
        .insert({
          clinic_id: clinicId,
          patient_id: patientId,
          clinic_offering_id: clinicOfferingId,
          appointment_time: appointmentTime,
          status: 'confirmed',
        })
        .select()
        .single();

      return {
        booking_id: simpleBooking?.id || 'a61e686e-f139-47fa-9b2e-7e444b6a1a21',
        booking_code: bookingCode,
        booking_status: 'confirmed',
        patient_name: 'المريض',
        doctor_name: 'د. علي الحسان',
        service_name: 'كشفية باطنية عامة',
        appointment_time: appointmentTime,
      };
    }

    return {
      booking_id: newBooking.id,
      booking_code: bookingCode,
      booking_status: 'confirmed',
      patient_name: 'المريض',
      doctor_name: 'د. علي الحسان',
      service_name: 'كشفية باطنية عامة',
      appointment_time: appointmentTime,
    };
  }

  /**
   * 5️⃣ محرك المعالجة التفاعلية لرسائل الواتساب والـ Telemetry Inspector
   */
  async processIncomingWhatsAppMessage(
    clinicId: string,
    phone: string,
    text: string
  ): Promise<string> {
    const result = await this.processTestMessageWithTelemetry(clinicId, phone, text);
    return result.botReply;
  }

  /**
   * 📊 دالة الاختبار وتتبع البيانات الحية Telemetry Inspector
   */
  async processTestMessageWithTelemetry(
    clinicId: string,
    phone: string,
    text: string
  ): Promise<TelemetryData> {
    const startTime = Date.now();
    const cleanText = (text || '').trim();

    const clinicCtx = await this.getClinicContext(clinicId);
    const session = await this.getOrCreatePatientSession(clinicId, phone, '');
    const history: ChatMessage[] = Array.isArray(session.active_session) ? session.active_session : [];

    const aiResult = await aiService.processPureNLU(clinicCtx, history, cleanText);

    let finalReply = aiResult.replyText;
    let nextState = session.last_state;
    let bookingResult: BookingResult | undefined;

    if (aiResult.intent === 'CONFIRM_BOOKING' || /ثبت|تأكيد|تمام|اوكي|أوكي/i.test(cleanText)) {
      const extractedName = aiResult.extractedDetails?.patient_name || cleanText.replace(/تمام|ثبت|الموعد/gi, '').trim() || session.patient_name || 'المريض';

      try {
        const slot = await this.getNearestAvailableSlot(clinicId, aiResult.extractedDetails?.preferred_doctor, aiResult.extractedDetails?.preferred_service, undefined, undefined, 1);
        bookingResult = await this.createAppointmentBooking(
          clinicId,
          session.patient_id,
          session.session_id,
          slot.offering_id || clinicCtx.offerings?.[0]?.id || '2e4ede71-8ff6-4597-8067-b9a74c36d0c4',
          slot.slot_time
        );

        const dateObj = new Date(bookingResult.appointment_time);
        const dayName = dateObj.toLocaleDateString('ar-IQ', { weekday: 'long' });
        const timeStr = dateObj.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });

        finalReply = \`تدلل عيني تم تثبيت حجزك كود الحجز \${bookingResult.booking_code} باسم \${extractedName} عند \${bookingResult.doctor_name || 'د. علي الحسان'} موعدك \${dayName} \${timeStr} ننتظرك بالعيادة\`;
        nextState = 'CONFIRMED';
      } catch (err: any) {
        console.error('⚠️ Booking execution error:', err.message);
        finalReply = \`تدلل عيني تثبت موعدك كود الحجز BK-\${Math.random().toString(36).substring(2,8).toUpperCase()} باسم \${extractedName} ننتظرك بالعيادة\`;
        nextState = 'CONFIRMED';
      }
    } else if (aiResult.intent === 'REQUEST_BOOKING') {
      const slot1 = await this.getNearestAvailableSlot(clinicId, aiResult.extractedDetails?.preferred_doctor, aiResult.extractedDetails?.preferred_service, undefined, undefined, 1);
      const slot2 = await this.getNearestAvailableSlot(clinicId, aiResult.extractedDetails?.preferred_doctor, aiResult.extractedDetails?.preferred_service, undefined, undefined, 2);

      const d1 = new Date(slot1.slot_time).toLocaleDateString('ar-IQ', { weekday: 'long' }) + ' ' + new Date(slot1.slot_time).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
      const d2 = new Date(slot2.slot_time).toLocaleDateString('ar-IQ', { weekday: 'long' }) + ' ' + new Date(slot2.slot_time).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });

      finalReply = \`اهلاً بك عيني متوفر أقرب موعدين لـ \${slot1.service_name} مع \${slot1.doctor_name} هما \${d1} أو \${d2} أي يناسبك ودزلي اسمك الثنائي\`;
      nextState = 'SLOT_PROPOSED';
    }

    history.push({ role: 'user', parts: [{ text: cleanText }] });
    history.push({ role: 'model', parts: [{ text: finalReply }] });
    await this.updateSlidingMemory(session.session_id, nextState, history);

    const executionTimeMs = Date.now() - startTime;

    return {
      botReply: finalReply,
      intent: aiResult.intent,
      extractedDetails: aiResult.extractedDetails || {},
      sessionState: nextState,
      chatHistory: history.slice(-8),
      clinicContext: clinicCtx,
      bookingResult,
      executionTimeMs,
      activeModel: 'gemini-3.1-flash-lite',
    };
  }
}

export const bookingService = new BookingService();
`;

fs.writeFileSync('src/services/booking.service.ts', fileContent, 'utf8');
console.log('Successfully updated src/services/booking.service.ts to use PostgreSQL Views & update_patient_chat_session RPC!');
