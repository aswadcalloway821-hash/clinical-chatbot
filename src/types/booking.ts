export type BookingState =
  | 'GREETING'
  | 'SELECT_DEPARTMENT'
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
  workingHours?: string;
  locationLink?: string;
}

export interface Service {
  id: string;
  name: string;
  type?: string;
  department?: string;
  price: number;
  durationMinutes: number;
  doctorName?: string;
  description?: string;
  offer?: string;
  preAppointmentInstructions?: string;
  postCareAdvice?: string;
}

export interface Doctor {
  id: string;
  branchId: string;
  branchName: string;
  name: string;
  specialty: string;
  secretariatPhone?: string;
  services: string[]; // Service IDs or names
  calendarId: string;
  doctorTitleExperience?: string;
  dailyPatientCapacity?: number;
  breakTimes?: string;
  workingDays: number[]; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  offDays?: string[]; // E.g. ["2026-08-15"]
  workingHours: {
    days: number[];
    startHour: number; // e.g. 9
    endHour: number;   // e.g. 17
    slotDurationMinutes: number;
  };
}

export interface TimeSlot {
  slotId: string;
  doctorId: string;
  doctorName?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  isLocked?: boolean;
  lockedUntil?: number;
}

export interface BookingSlots {
  branchId?: string;
  branchName?: string;
  department?: string;
  serviceId?: string;
  serviceName?: string;
  doctorId?: string;
  doctorName?: string;
  date?: string;
  startTime?: string;
  patientName?: string;
}

export type SessionStatus = 'IN_PROGRESS' | 'COMPLETED_LOCKED' | 'MODIFYING';

export interface PatientSession {
  phoneNumber: string;
  tenantId: string;
  currentState: BookingState;
  status?: SessionStatus;
  slots?: BookingSlots;
  selectedDepartment?: string;
  selectedBranchId?: string;
  selectedBranchName?: string;
  selectedServiceId?: string;
  selectedServiceName?: string;
  selectedDoctorId?: string;
  selectedDoctorName?: string;
  selectedSlot?: TimeSlot;
  customRequestedDate?: string;
  patientName?: string;
  patientTag?: 'NEW' | 'RETURNING';
  isReturningPatient?: boolean;
  failedNluAttempts: number;
  lastInteractionTime: number;
  interruptedState?: BookingState; // For Freeze & Resume protocol
  bookingCode?: string;
  dailyMessageCount?: number;
  lastMessageDate?: string;
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
  department?: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  createdAt: string;
  notes?: string;
  reminderStatus?: string;
  platform?: string;
}

export interface PatientCRM {
  phoneNumber: string;
  patientName: string;
  platform?: string;
  totalBookings: number;
  lastVisitDate?: string;
  noShowCount?: number;
  notes?: string;
}

export interface ComplaintRecord {
  timestamp: string;
  patientName: string;
  phoneNumber: string;
  complaintContent: string;
  status: string;
}

export interface AnalyticsRecord {
  date: string;
  incomingMessages: number;
  totalBookings: number;
  cancelledBookings: number;
  noShows: number;
  recoveredRevenue: number;
}

export interface TenantConfig {
  tenantId: string;
  clinicName: string;
  secretaryPhone: string;
  branches: Branch[];
  services: Service[];
  doctors: Doctor[];
  faqs: Array<{ question: string; answer: string }>;
  departments: string[];
}

export interface NLUResult {
  intent: 
    | 'GREETING'
    | 'SELECT_DEPARTMENT'
    | 'SELECT_BRANCH'
    | 'SELECT_SERVICE'
    | 'SELECT_DOCTOR'
    | 'SELECT_SLOT'
    | 'PROVIDE_NAME'
    | 'CONFIRM'
    | 'CANCEL'
    | 'CANCEL_BOOKING'
    | 'MODIFY_BOOKING'
    | 'ASK_FAQ'
    | 'REQUEST_HUMAN'
    | 'ANGRY_EXPRESSION'
    | 'UNKNOWN';
  entities: {
    departmentName?: string;
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
