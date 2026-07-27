import { supabase } from '../config/supabase';

export interface PatientSessionResult {
  patient_id: string;
  session_id: string;
  patient_name: string;
  patient_phone: string;
  is_new_patient: boolean;
  last_state?: string;
}

export interface NearestSlotResult {
  clinic_offering_id: string;
  doctor_id: string;
  doctor_name: string;
  google_calendar_id?: string;
  available_date: string;
  start_time: string;
  end_time: string;
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
   * 1️⃣ إنشاء أو جلب جلسة المريض ومُعرّفه
   */
  async getOrCreatePatientSession(
    p_clinic_id: string,
    p_patient_phone: string,
    p_patient_name: string
  ): Promise<PatientSessionResult> {
    const { data, error } = await supabase.rpc('get_or_create_patient_session', {
      p_clinic_id,
      p_patient_phone,
      p_patient_name,
    });

    if (error) {
      throw new Error(`DB Error [getOrCreatePatientSession]: ${error.message}`);
    }

    const result = Array.isArray(data) ? data[0] : data;
    return result as PatientSessionResult;
  }

  /**
   * 2️⃣ البحث عن أقرب موعد شاغر لخدمة وعيادة معينة
   */
  async getNearestAvailableSlot(
    p_clinic_id: string,
    p_branch_id: string,
    p_department_id: string,
    p_service_id: string,
    p_target_date: string
  ): Promise<NearestSlotResult[]> {
    const { data, error } = await supabase.rpc('get_nearest_available_slot', {
      p_clinic_id,
      p_branch_id,
      p_department_id,
      p_service_id,
      p_target_date,
    });

    if (error) {
      throw new Error(`DB Error [getNearestAvailableSlot]: ${error.message}`);
    }

    return (data || []) as NearestSlotResult[];
  }

  /**
   * 3️⃣ تنفيذ الحجز الذري المباشر
   */
  async createAppointmentBooking(
    p_clinic_id: string,
    p_patient_id: string,
    p_session_id: string,
    p_clinic_offering_id: string,
    p_appointment_time: string
  ): Promise<BookingResult> {
    const { data, error } = await supabase.rpc('create_appointment_booking', {
      p_clinic_id,
      p_patient_id,
      p_session_id,
      p_clinic_offering_id,
      p_appointment_time,
    });

    if (error) {
      throw new Error(`DB Error [createAppointmentBooking]: ${error.message}`);
    }

    const result = Array.isArray(data) ? data[0] : data;
    return result as BookingResult;
  }
}

export const bookingService = new BookingService();
