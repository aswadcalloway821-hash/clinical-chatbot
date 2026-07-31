export type BookingState =
  | 'GREETING'
  | 'SELECT_BRANCH'
  | 'SELECT_SERVICE'
  | 'SELECT_DOCTOR'
  | 'SELECT_DATE_TIME'
  | 'COLLECT_PATIENT_NAME'
  | 'CONFIRMATION_PENDING'
  | 'CONFIRMED'
  | 'HUMAN_HANDOFF';

export interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
}

export interface Service {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  description?: string;
}

export interface Doctor {
  id: string;
  branchId: string;
  name: string;
  specialty: string;
  services: string[]; // Service IDs
  calendarId?: string;
  workingHours: {
    days: number[]; // 0 = Sun, 1 = Mon, ..., 6 = Sat
    startHour: number; // e.g. 9
    endHour: number;   // e.g. 17
    slotDurationMinutes: number;
  };
}

export interface TimeSlot {
  slotId: string;
  doctorId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  isLocked?: boolean;
  lockedUntil?: number;
}

export interface PatientSession {
  phoneNumber: string;
  tenantId: string;
  currentState: BookingState;
  selectedBranchId?: string;
  selectedServiceId?: string;
  selectedDoctorId?: string;
  selectedSlot?: TimeSlot;
  patientName?: string;
  patientTag?: 'NEW' | 'RETURNING';
  failedNluAttempts: number;
  lastInteractionTime: number;
  interruptedState?: BookingState; // For Freeze & Resume protocol
  bookingCode?: string;
}

export interface Booking {
  bookingCode: string;
  tenantId: string;
  patientPhone: string;
  patientName: string;
  patientTag: 'NEW' | 'RETURNING';
  branchId: string;
  branchName: string;
  doctorId: string;
  doctorName: string;
  serviceId: string;
  serviceName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  createdAt: string;
}

export interface TenantConfig {
  tenantId: string;
  clinicName: string;
  secretaryPhone: string;
  branches: Branch[];
  services: Service[];
  doctors: Doctor[];
  faqs: Array<{ question: string; answer: string }>;
}

export interface NLUResult {
  intent: 
    | 'GREETING'
    | 'SELECT_BRANCH'
    | 'SELECT_SERVICE'
    | 'SELECT_DOCTOR'
    | 'SELECT_SLOT'
    | 'PROVIDE_NAME'
    | 'CONFIRM'
    | 'CANCEL'
    | 'ASK_FAQ'
    | 'REQUEST_HUMAN'
    | 'ANGRY_EXPRESSION'
    | 'UNKNOWN';
  entities: {
    branchName?: string;
    serviceName?: string;
    doctorName?: string;
    date?: string;
    time?: string;
    slotId?: string;
    patientName?: string;
    faqQuestion?: string;
  };
  confidence: number;
}
