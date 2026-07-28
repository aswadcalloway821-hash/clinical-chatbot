import { supabase } from '../config/supabase';
import { aiService, ChatMessage, AIStructuredResponse } from './ai.service';

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
   * 🧹 تصفير وإعادة تعيين الجلسة الحالية في Supabase
   */
  async resetPatientSession(clinicId: string, phone: string): Promise<boolean> {
    try {
      const session = await this.getOrCreatePatientSession(clinicId, phone, '');
      await supabase
        .from('patient_chat_sessions')
        .update({
          last_state: 'INIT',
          active_session: [],
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.session_id);
      return true;
    } catch (err: any) {
      console.warn('⚠️ Failed to reset session:', err.message);
      return false;
    }
  }

  /**
   * 📋 جلب أحدث الحجوزات الحية المخزنة في Supabase PostgreSQL
   */
  async getRecentBookings(clinicId: string): Promise<any[]> {
    try {
      const { data } = await supabase
        .from('bookings')
        .select(`
          id,
          booking_code,
          appointment_time,
          status,
          created_at,
          patients (full_name, phone)
        `)
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false })
        .limit(10);

      return (data || []).map((b: any) => ({
        booking_code: b.booking_code,
        patient_name: b.patients?.full_name || 'مريض',
        phone: b.patients?.phone || '',
        appointment_time: b.appointment_time,
        status: b.status,
        created_at: b.created_at,
      }));
    } catch (err: any) {
      console.warn('⚠️ Failed to fetch recent bookings:', err.message);
      return [];
    }
  }

  /**
   * 🧠 النافذة المتزلقة لـ 8 رسائل كحد أقصى (Sliding Window Context Buffer - 4 Turns Max)
   */
  async updateSlidingMemory(
    sessionId: string,
    newState: string,
    history: ChatMessage[]
  ): Promise<void> {
    try {
      const slidingWindowMemory = history.slice(-8); // 8 رسائل = 4 أزواج كحد أقصى
      await supabase
        .from('patient_chat_sessions')
        .update({
          last_state: newState,
          active_session: slidingWindowMemory,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
    } catch (err: any) {
      console.warn('⚠️ Failed to update sliding memory:', err.message);
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
      active_session: Array.isArray(row.active_session) ? row.active_session : [],
    };
  }

  /**
   * 2️⃣ البحث المباشر عن الشواغر باستعلام الفهارس المركبة في PostgreSQL
   */
  async getNearestAvailableSlot(
    clinicId: string,
    branchId?: string,
    departmentId?: string,
    serviceId?: string,
    targetDate?: string,
    offsetDays: number = 6
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
   * 4️⃣ محرك Pure Gemini NLU Master Engine التفاعلي مع هندسة الخيارات المحدودة والنافذة المتزلقة
   */
  async processIncomingWhatsAppMessage(
    clinicId: string,
    phone: string,
    text: string
  ): Promise<string> {
    const res = await this.processTestMessageWithTelemetry(clinicId, phone, text);
    return res.botReply;
  }

  /**
   * 🔍 دالة تتبع البيانات الحية Telemetry Data Inspector للمحاكاة المباشرة
   */
  async processTestMessageWithTelemetry(
    clinicId: string,
    phone: string,
    text: string
  ): Promise<TelemetryData> {
    const startTime = Date.now();
    const cleanText = (text || '').trim();

    // 1. جلب سياق العيادة وجلسة المريض
    const clinicCtx = await this.getClinicContext(clinicId);
    const session = await this.getOrCreatePatientSession(clinicId, phone, '');
    const activeOfferingId = clinicCtx.offerings?.[0]?.id || '2e4ede71-8ff6-4597-8067-b9a74c36d0c4';
    const primaryDoctorName = clinicCtx.doctors?.[0]?.name || 'د علي الحسان';

    // 2. قراءة الذاكرة المتزلقة (آخر 8 رسائل)
    const history: ChatMessage[] = Array.isArray(session.active_session) ? session.active_session : [];

    // 3. تحليل النية عبر Pure Gemini NLU
    const nluResult: AIStructuredResponse = await aiService.processPureNLU(clinicCtx, history, cleanText);

    let finalReply = nluResult.replyText;
    let nextState = session.last_state;
    let createdBooking: BookingResult | undefined = undefined;

    // 4. تنفيذ المنطق الموجه بالنية (Intent-Driven Control Flow)
    if (nluResult.intent === 'CONFIRM_BOOKING') {
      const patientName = nluResult.extractedDetails?.patient_name || (cleanText.length < 30 ? cleanText : 'المريض الفاضل');

      try {
        let slot = await this.getNearestAvailableSlot(clinicId, undefined, undefined, undefined, undefined, 6);

        try {
          createdBooking = await this.createAppointmentBooking(
            clinicId,
            session.patient_id,
            session.session_id,
            activeOfferingId,
            slot.slot_time
          );
        } catch (bErr) {
          slot = await this.getNearestAvailableSlot(clinicId, undefined, undefined, undefined, undefined, 7);
          createdBooking = await this.createAppointmentBooking(
            clinicId,
            session.patient_id,
            session.session_id,
            activeOfferingId,
            slot.slot_time
          );
        }

        const dateFormatted = new Date(createdBooking.appointment_time).toLocaleString('ar-IQ', {
          weekday: 'long',
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        finalReply = `تدلل عيني تم تثبيت حجزك كود الحجز ${createdBooking.booking_code} باسم ${patientName} عند ${createdBooking.doctor_name || primaryDoctorName} موعدك ${dateFormatted} ننتظرك بالعيادة`;
        nextState = 'CONFIRMED';
      } catch (err: any) {
        finalReply = `عيني هذا الموعد انحجز قبل لحظات متوفر موعد الخميس 4 م أو الجمعة 5 م أي يناسبك حتى نثبته`;
      }
    } else if (nluResult.intent === 'REQUEST_BOOKING') {
      nextState = 'SLOT_PROPOSED';
      const slot1 = await this.getNearestAvailableSlot(clinicId, undefined, undefined, undefined, undefined, 6);
      const slot2 = await this.getNearestAvailableSlot(clinicId, undefined, undefined, undefined, undefined, 7);
      
      const d1 = new Date(slot1.slot_time).toLocaleString('ar-IQ', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
      const d2 = new Date(slot2.slot_time).toLocaleString('ar-IQ', { weekday: 'long', hour: '2-digit', minute: '2-digit' });

      finalReply = `اهلاً بك عيني متوفر أقرب موعدين لـ ${slot1.service_name} مع ${slot1.doctor_name} هما ${d1} أو ${d2} أي يناسبك ودزلي اسمك الثنائي`;
    }

    // 5. حفظ وتحديث النافذة المتزلقة (8 رسائل) في Supabase
    history.push({ role: 'user', parts: [{ text: cleanText }] });
    history.push({ role: 'model', parts: [{ text: finalReply }] });
    await this.updateSlidingMemory(session.session_id, nextState, history);

    const executionTimeMs = Date.now() - startTime;

    return {
      botReply: finalReply,
      intent: nluResult.intent,
      extractedDetails: nluResult.extractedDetails || {},
      sessionState: nextState,
      chatHistory: history.slice(-8),
      clinicContext: clinicCtx,
      bookingResult: createdBooking,
      executionTimeMs,
      activeModel: 'gemini-2.5-flash-lite',
    };
  }
}

export const bookingService = new BookingService();
