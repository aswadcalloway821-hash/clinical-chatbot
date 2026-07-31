import { PatientSession, TenantConfig, Booking, TimeSlot } from '../types/booking.js';
import { GeminiService } from '../services/gemini.js';
import { ContextSlicer } from './context-slicer.js';
import { HandoffManager } from '../services/handoff-manager.js';
import { SlotGenerator } from '../services/slot-generator.js';
import { GoogleSheetsService } from '../services/google-sheets.js';
import { GoogleCalendarService } from '../services/google-calendar.js';

export class FsmStateManager {
  private static sessions: Map<string, PatientSession> = new Map();

  public static getSessionsStore(): Map<string, PatientSession> {
    return this.sessions;
  }

  /**
   * Process incoming WhatsApp user message through FSM Engine
   */
  public static async processMessage(
    phone: string,
    messageText: string,
    tenant: TenantConfig
  ): Promise<string> {
    let session = this.sessions.get(phone);

    if (!session) {
      const patientTag = await GoogleSheetsService.getPatientHistoryTag(phone);
      session = {
        phoneNumber: phone,
        tenantId: tenant.tenantId,
        currentState: 'GREETING',
        patientTag,
        failedNluAttempts: 0,
        lastInteractionTime: Date.now()
      };
      this.sessions.set(phone, session);
    }

    session.lastInteractionTime = Date.now();

    // 1. Extract NLU Intent & Entities via Gemini
    const nluResult = await GeminiService.parseNluIntent(
      messageText,
      session.currentState,
      tenant
    );

    // 2. Check for Human Handoff trigger
    if (HandoffManager.shouldTriggerHandoff(session, nluResult.intent, nluResult.confidence)) {
      return HandoffManager.executeHandoff(session, tenant);
    }

    // 3. Freeze & Resume Protocol (Handle side questions e.g. Prices/Location)
    if (nluResult.intent === 'ASK_FAQ') {
      const faqAnswer = await GeminiService.answerFaq(messageText, tenant);
      
      // Resume instruction for current state
      const sliced = ContextSlicer.slice(session, tenant, messageText);
      const resumePrompt = await GeminiService.generateIraqiResponse(sliced);

      return `${faqAnswer}\n\nنكمل حجزك عيني؟ ${resumePrompt}`;
    }

    // 4. FSM State Transition Engine
    let responseText = '';

    switch (session.currentState) {
      case 'GREETING':
        // Move to SELECT_BRANCH or SELECT_SERVICE
        if (nluResult.entities.branchName) {
          const matchBranch = tenant.branches.find(b => b.name.includes(nluResult.entities.branchName!));
          if (matchBranch) session.selectedBranchId = matchBranch.id;
        }
        session.currentState = 'SELECT_BRANCH';
        session.failedNluAttempts = 0;
        break;

      case 'SELECT_BRANCH':
        if (nluResult.entities.branchName) {
          const matchBranch = tenant.branches.find(b => b.name.includes(nluResult.entities.branchName!));
          if (matchBranch) {
            session.selectedBranchId = matchBranch.id;
            session.currentState = 'SELECT_SERVICE';
            session.failedNluAttempts = 0;
          } else {
            session.failedNluAttempts++;
          }
        } else {
          // Default to first branch if user selected option 1
          session.selectedBranchId = tenant.branches[0].id;
          session.currentState = 'SELECT_SERVICE';
        }
        break;

      case 'SELECT_SERVICE':
        if (nluResult.entities.serviceName) {
          const matchService = tenant.services.find(s => s.name.includes(nluResult.entities.serviceName!));
          if (matchService) {
            session.selectedServiceId = matchService.id;
            session.currentState = 'SELECT_DOCTOR';
            session.failedNluAttempts = 0;
          } else {
            session.failedNluAttempts++;
          }
        } else {
          session.selectedServiceId = tenant.services[0].id;
          session.currentState = 'SELECT_DOCTOR';
        }
        break;

      case 'SELECT_DOCTOR':
        if (nluResult.entities.doctorName) {
          const matchDoctor = tenant.doctors.find(d => d.name.includes(nluResult.entities.doctorName!));
          if (matchDoctor) {
            session.selectedDoctorId = matchDoctor.id;
            session.currentState = 'SELECT_DATE_TIME';
            session.failedNluAttempts = 0;
          } else {
            session.failedNluAttempts++;
          }
        } else {
          session.selectedDoctorId = tenant.doctors[0].id;
          session.currentState = 'SELECT_DATE_TIME';
        }

        // Generate available slots & lock temporary slot
        if (session.selectedDoctorId) {
          const doctor = tenant.doctors.find(d => d.id === session.selectedDoctorId)!;
          const todayDate = new Date().toISOString().split('T')[0];
          const slots = SlotGenerator.generateAvailableSlots(doctor, todayDate, []);
          
          if (slots.length > 0) {
            session.selectedSlot = slots[0];
            SlotGenerator.lockSlotTemporarily(slots[0]);
          }
        }
        break;

      case 'SELECT_DATE_TIME':
        if (nluResult.intent === 'SELECT_SLOT' || nluResult.intent === 'CONFIRM' || session.selectedSlot) {
          session.currentState = 'COLLECT_PATIENT_NAME';
          session.failedNluAttempts = 0;
        } else {
          session.failedNluAttempts++;
        }
        break;

      case 'COLLECT_PATIENT_NAME':
        if (nluResult.entities.patientName || messageText.length > 2) {
          session.patientName = nluResult.entities.patientName || messageText.trim();
          session.currentState = 'CONFIRMATION_PENDING';
          session.failedNluAttempts = 0;
        } else {
          session.failedNluAttempts++;
        }
        break;

      case 'CONFIRMATION_PENDING':
        if (nluResult.intent === 'CONFIRM' || messageText.includes('نعم') || messageText.includes('تأكيد') || messageText.includes('اوكي')) {
          session.currentState = 'CONFIRMED';
          session.bookingCode = GoogleSheetsService.generateBookingCode();

          const branch = tenant.branches.find(b => b.id === session.selectedBranchId)!;
          const doctor = tenant.doctors.find(d => d.id === session.selectedDoctorId)!;
          const service = tenant.services.find(s => s.id === session.selectedServiceId)!;

          const booking: Booking = {
            bookingCode: session.bookingCode,
            tenantId: tenant.tenantId,
            patientPhone: phone,
            patientName: session.patientName || 'مراجع كريم',
            patientTag: session.patientTag || 'NEW',
            branchId: branch.id,
            branchName: branch.name,
            doctorId: doctor.id,
            doctorName: doctor.name,
            serviceId: service.id,
            serviceName: service.name,
            date: session.selectedSlot?.date || new Date().toISOString().split('T')[0],
            startTime: session.selectedSlot?.startTime || '16:00',
            endTime: session.selectedSlot?.endTime || '16:30',
            status: 'CONFIRMED',
            createdAt: new Date().toISOString()
          };

          // Save to Google Sheets DB & Sync to Google Calendar
          await GoogleSheetsService.saveBooking(booking);
          await GoogleCalendarService.syncAppointment(booking, doctor);
        } else if (nluResult.intent === 'CANCEL') {
          if (session.selectedSlot) SlotGenerator.unlockSlot(session.selectedSlot);
          session.currentState = 'GREETING';
          return 'تم إلغاء طلب الحجز بنجاح عيني. شوكت ما تحب تحجز احنا بانتظارك برحابة صدر.';
        }
        break;

      case 'CONFIRMED':
        // If patient responds after confirmation, greet nicely
        session.currentState = 'GREETING';
        break;
    }

    // 5. Generate Iraqi Persona Response via Context Slicer
    const sliced = ContextSlicer.slice(session, tenant, messageText);
    responseText = await GeminiService.generateIraqiResponse(sliced);

    return responseText;
  }
}
