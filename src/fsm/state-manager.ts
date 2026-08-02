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
   * Process incoming WhatsApp user message through FSM Engine with full Error Catching & Daily Rate Limiting
   */
  public static async processMessage(
    phone: string,
    messageText: string,
    tenant: TenantConfig
  ): Promise<string> {
    const todayStr = new Date().toISOString().split('T')[0];
    const dailyLimit = parseInt(process.env.DAILY_MESSAGE_LIMIT || '1000', 10);

    // Explicit Reset Trigger: ONLY reset session when user explicitly writes "تصفير" or "ريست" or "reset"
    const isExplicitReset = /^(تصفير|ريست|reset|إعادة ضبط)$/i.test(messageText.trim());

    if (isExplicitReset) {
      this.sessions.delete(phone);
      GoogleSheetsService.clearCache(); // Force fresh cache reload on explicit reset
      const crmPatient = await GoogleSheetsService.lookupPatientCRM(phone);
      const newSession: PatientSession = {
        phoneNumber: phone,
        tenantId: tenant.tenantId,
        currentState: 'GREETING',
        patientName: crmPatient?.patientName,
        isReturningPatient: !!crmPatient,
        patientTag: crmPatient ? 'RETURNING' : 'NEW',
        failedNluAttempts: 0,
        lastInteractionTime: Date.now(),
        dailyMessageCount: 1,
        lastMessageDate: todayStr
      };
      this.sessions.set(phone, newSession);

      const branchDeptStrings = tenant.branches.map((b, i) => {
        const branchDoctors = tenant.doctors.filter(d => d.branchId === b.id || d.branchName === b.name);
        const branchServices = tenant.services.filter(s =>
          branchDoctors.some(d => d.name === s.doctorName || !s.doctorName)
        );
        const branchDepts = Array.from(new Set(branchServices.map(s => s.department).filter(Boolean)));
        const deptStr = branchDepts.length > 0 ? branchDepts.join(' ، ') : (tenant.departments ? tenant.departments.join(' ، ') : 'عام');
        return `${i + 1}. فرع ${b.name} بيه قسم (${deptStr})`;
      });

      return `تم تصفير المحادثة وإعادة الضبط بنجاح عيني. 🌸

صباح النور والسرور، نورت عيادة ${tenant.clinicName}. تدلل، هاي الفروع وأقسامها المتوفرة عندنا وبأي واحد تحب نحجزلك:

${branchDeptStrings.join('\n')}

شوف أقرب فرع ويا قسم تحتاج وتدلل علمود أنطيك أقرب حجز، شنو الاختيار اللي يناسبك حتى نكمل باقي الإجراءات وياك؟`;
    }

    let session = this.sessions.get(phone);

    // First-Touch CRM Pre-fetch: Lookup patient records on initial message
    if (!session) {
      const crmPatient = await GoogleSheetsService.lookupPatientCRM(phone);
      session = {
        phoneNumber: phone,
        tenantId: tenant.tenantId,
        currentState: 'GREETING',
        patientName: crmPatient?.patientName,
        isReturningPatient: !!crmPatient,
        patientTag: crmPatient ? 'RETURNING' : 'NEW',
        failedNluAttempts: 0,
        lastInteractionTime: Date.now(),
        dailyMessageCount: 1,
        lastMessageDate: todayStr
      };
      this.sessions.set(phone, session);
    } else {
      // Track Daily Message Rate Limiter
      if (session.lastMessageDate !== todayStr) {
        session.dailyMessageCount = 1;
        session.lastMessageDate = todayStr;
      } else {
        session.dailyMessageCount = (session.dailyMessageCount || 0) + 1;
      }
    }

    session.lastInteractionTime = Date.now();

    // Daily Message Rate Limit Gate (Spam & Token Shield)
    if ((session.dailyMessageCount || 0) > dailyLimit) {
      console.warn(`[Rate Limit Exceeded] Phone ${phone} reached daily limit of ${dailyLimit} messages.`);
      return `عذراً عيني، وصلنا للحد الأقصى المسموح للرسائل اليومية للحفاظ على جودة الخدمة. تقدر تتواصل وتكمل حجزك مباشرة وية السكرتارية على هذا الرقم المباشر: ${tenant.secretaryPhone} خلال ساعات الدوام الرسمية.`;
    }

    // Top-Level Exception Catching Engine for Automated System Error Logging
    try {
      // 1. Extract NLU Intent & Entities via Gemini
      const nluResult = await GeminiService.parseNluIntent(
        messageText,
        session.currentState,
        tenant
      );

      // 2. Modify & Cancel Booking Protocol: Handle active booking cancellation or modification
      const isCancelRequest = nluResult.intent === 'CANCEL_BOOKING' || /إلغاء الحجز|الغاء الحجز|الغي الحجز|أريد ألغي/i.test(messageText);
      const isModifyRequest = nluResult.intent === 'MODIFY_BOOKING' || /تعديل الحجز|أغير الموعد|تغيير الموعد/i.test(messageText);

      if (isCancelRequest || isModifyRequest) {
        const activeBooking = await GoogleSheetsService.findActiveBookingByPhone(phone);
        if (activeBooking) {
          if (isCancelRequest) {
            const success = await GoogleSheetsService.cancelBookingInSheet(activeBooking.bookingCode);
            if (success) {
              this.sessions.delete(phone);
              return `تم إلغاء حجزك السابق (${activeBooking.bookingCode}) بنجاح عيني. إذا حبيت تحجز موعد جديد بأي وقت، إحنا بانتظارك برحابة صدر! 🌸`;
            } else {
              return `عيني حاولنا نلغي الحجز لكود ${activeBooking.bookingCode} وبس صار خلل بالشبكة، راح نحولك لـ السكرتير للتأكيد المباشر.`;
            }
          } else if (isModifyRequest) {
            await GoogleSheetsService.cancelBookingInSheet(activeBooking.bookingCode);
            session.currentState = 'GREETING';
            return `تم إلغاء حجزك السابق (${activeBooking.bookingCode}) لتعديل الموعد. تفضل اختار القسم والفرع المناسب إلك لتثبيت موعدك الجديد! ✨`;
          }
        } else {
          return `عيني ما لقينا حجز نشط مسجل بهاد الرقم. إذا تحب تثبت حجز جديد، كليلي شنو القسم أو الخدمة المحتاجها وتدلل!`;
        }
      }

      // 3. Check for Human Handoff trigger (Immediate transfer on Complaint / Anger / Human Request)
      if (
        nluResult.intent === 'REQUEST_HUMAN' ||
        nluResult.intent === 'ANGRY_EXPRESSION' ||
        HandoffManager.shouldTriggerHandoff(session, nluResult.intent, nluResult.confidence)
      ) {
        // Log complaint to Sheets upon handoff (Throttled CRM write point)
        await GoogleSheetsService.logComplaint({
          timestamp: new Date().toISOString(),
          patientName: session.patientName || 'مراجع كريم',
          phoneNumber: phone,
          complaintContent: messageText,
          status: 'PENDING'
        });
        if (session.patientName) {
          await GoogleSheetsService.savePatientCRM({
            phoneNumber: phone,
            patientName: session.patientName,
            platform: 'WhatsApp',
            totalBookings: 1,
            lastVisitDate: new Date().toISOString().split('T')[0]
          });
        }
        return HandoffManager.executeHandoff(session, tenant);
      }

      // 4. Freeze & Resume Protocol (General FAQ Inquiries only)
      if (nluResult.intent === 'ASK_FAQ') {
        const faqAnswer = await GeminiService.answerFaq(messageText, tenant);
        const sliced = ContextSlicer.slice(session, tenant, messageText);
        const resumePrompt = await GeminiService.generateIraqiResponse(sliced, tenant);
        return `${faqAnswer}\n${resumePrompt}`;
      }

      // Check for explicit full list bypass ("اعرض كل الفروع" / "اعرض كل الخدمات")
      const requestsFullBranches = /اعرض (كل|جميع) (الفروع|فروع)/i.test(messageText);
      const requestsFullServices = /اعرض (كل|جميع) (الخدمات|خدمات)/i.test(messageText);

      // Helper for Direct Index Matching (1-based index matching e.g., "1", "2", "3")
      const trimmedMsg = messageText.trim();
      const numMatch = trimmedMsg.match(/^(?:رقم\s*)?([1-9]\d*)$/);
      const inputIndex = numMatch ? parseInt(numMatch[1]) - 1 : -1;

      // 5. FSM State Transition Engine
      let responseText = '';

      switch (session.currentState) {
        case 'GREETING':
          if (inputIndex >= 0 && inputIndex < tenant.branches.length) {
            session.selectedBranchId = tenant.branches[inputIndex].id;
            session.selectedBranchName = tenant.branches[inputIndex].name;
            const branchDoctors = tenant.doctors.filter(d => d.branchId === tenant.branches[inputIndex].id || d.branchName === tenant.branches[inputIndex].name);
            const branchServices = tenant.services.filter(s => branchDoctors.some(d => d.name === s.doctorName || !s.doctorName));
            const branchDepts = Array.from(new Set(branchServices.map(s => s.department).filter(Boolean)));
            if (branchDepts.length > 0) {
              session.selectedDepartment = branchDepts[0];
            }
          }

          const initBranch = tenant.branches.find(b => messageText.includes(b.name));
          const initDept = (tenant.departments || []).find(d => messageText.includes(d));

          if (initBranch) {
            session.selectedBranchId = initBranch.id;
            session.selectedBranchName = initBranch.name;
          }
          if (initDept) {
            session.selectedDepartment = initDept;
          }

          if (session.selectedBranchId || session.selectedDepartment) {
            session.currentState = 'SELECT_SERVICE';
          } else {
            session.currentState = 'GREETING';
            const branchDeptStrings = tenant.branches.map((b, i) => {
              const branchDoctors = tenant.doctors.filter(d => d.branchId === b.id || d.branchName === b.name);
              const branchServices = tenant.services.filter(s =>
                branchDoctors.some(d => d.name === s.doctorName || !s.doctorName)
              );
              const branchDepts = Array.from(new Set(branchServices.map(s => s.department).filter(Boolean)));
              const deptStr = branchDepts.length > 0 ? branchDepts.join(' ، ') : (tenant.departments ? tenant.departments.join(' ، ') : 'عام');
              return `${i + 1}. فرع ${b.name} بيه قسم (${deptStr})`;
            });

            return `صباح النور والسرور، نورت عيادة ${tenant.clinicName}. تدلل، هاي الفروع وأقسامها المتوفرة عندنا وبأي واحد تحب نحجزلك:

${branchDeptStrings.join('\n')}

شوف أقرب فرع ويا قسم تحتاج وتدلل علمود أنطيك أقرب حجز، شنو الاختيار اللي يناسبك حتى نكمل باقي الإجراءات وياك؟`;
          }
          session.failedNluAttempts = 0;
          break;

        case 'SELECT_DEPARTMENT':
          // Check for direct index or text match for department
          if (inputIndex >= 0 && tenant.departments && inputIndex < tenant.departments.length) {
            session.selectedDepartment = tenant.departments[inputIndex];
            session.failedNluAttempts = 0;
          } else if (nluResult.entities.departmentName) {
            session.selectedDepartment = nluResult.entities.departmentName;
            session.failedNluAttempts = 0;
          } else if (tenant.departments && tenant.departments.length > 0) {
            const matchDept = tenant.departments.find(d => messageText.includes(d));
            session.selectedDepartment = matchDept || session.selectedDepartment || tenant.departments[0];
          }

          // Check if user also mentioned branch in the same message
          const matchedBranchInDept = tenant.branches.find(b => messageText.includes(b.name) || (nluResult.entities.branchName && b.name.includes(nluResult.entities.branchName)));
          if (matchedBranchInDept) {
            session.selectedBranchId = matchedBranchInDept.id;
            session.selectedBranchName = matchedBranchInDept.name;
          }

          // Auto-Branch Resolution Gate: If branch is already known or only 1 branch offers this department
          const matchingBranches = tenant.branches.filter(b => {
            const deptServices = tenant.services.filter(s => s.department === session.selectedDepartment);
            const deptDoctors = tenant.doctors.filter(d => deptServices.some(s => s.doctorName === d.name || !s.doctorName));
            return deptDoctors.some(d => d.branchName === b.name || d.branchId === b.id);
          });

          if (session.selectedBranchId || (matchingBranches.length === 1 && !requestsFullBranches)) {
            if (!session.selectedBranchId && matchingBranches.length === 1) {
              session.selectedBranchId = matchingBranches[0].id;
              session.selectedBranchName = matchingBranches[0].name;
            }
            session.currentState = 'SELECT_SERVICE';
          } else {
            session.currentState = 'SELECT_BRANCH';
          }
          break;

        case 'SELECT_BRANCH':
          const availBranches = tenant.branches;
          if (inputIndex >= 0 && inputIndex < availBranches.length) {
            session.selectedBranchId = availBranches[inputIndex].id;
            session.selectedBranchName = availBranches[inputIndex].name;
            session.currentState = 'SELECT_SERVICE';
            session.failedNluAttempts = 0;
          } else if (nluResult.entities.branchName) {
            const matchBranch = availBranches.find(b => b.name.includes(nluResult.entities.branchName!));
            if (matchBranch) {
              session.selectedBranchId = matchBranch.id;
              session.selectedBranchName = matchBranch.name;
              session.currentState = 'SELECT_SERVICE';
              session.failedNluAttempts = 0;
            } else {
              session.failedNluAttempts++;
            }
          } else {
            const matchBranch = availBranches.find(b => messageText.includes(b.name)) || availBranches[0];
            session.selectedBranchId = matchBranch.id;
            session.selectedBranchName = matchBranch.name;
            session.currentState = 'SELECT_SERVICE';
          }
          break;

        case 'SELECT_SERVICE':
          const deptServices = session.selectedDepartment
            ? tenant.services.filter(s => s.department === session.selectedDepartment)
            : tenant.services;

          const targetServices = deptServices.length > 0 ? deptServices : tenant.services;

          // Single Option Auto-Selection Gate: If only 1 service exists in department, auto-select!
          if (deptServices.length === 1 && !requestsFullServices) {
            session.selectedServiceId = deptServices[0].id;
            session.selectedServiceName = deptServices[0].name;
            session.currentState = 'SELECT_DOCTOR';
          } else if (inputIndex >= 0 && inputIndex < targetServices.length) {
            session.selectedServiceId = targetServices[inputIndex].id;
            session.selectedServiceName = targetServices[inputIndex].name;
            session.currentState = 'SELECT_DOCTOR';
            session.failedNluAttempts = 0;
          } else if (nluResult.entities.serviceName) {
            const matchService = targetServices.find(s => s.name.includes(nluResult.entities.serviceName!));
            if (matchService) {
              session.selectedServiceId = matchService.id;
              session.selectedServiceName = matchService.name;
              session.currentState = 'SELECT_DOCTOR';
              session.failedNluAttempts = 0;
            } else {
              session.failedNluAttempts++;
            }
          } else {
            const matchService = targetServices[0];
            session.selectedServiceId = matchService.id;
            session.selectedServiceName = matchService.name;
            session.currentState = 'SELECT_DOCTOR';
          }
          break;

        case 'SELECT_DOCTOR':
          const selectedBranchDoctors = tenant.doctors.filter(
            d => (!session.selectedBranchId || d.branchId === session.selectedBranchId || d.branchName === session.selectedBranchName)
          );
          const targetDoctors = selectedBranchDoctors.length > 0 ? selectedBranchDoctors : tenant.doctors;

          if (inputIndex >= 0 && inputIndex < targetDoctors.length) {
            session.selectedDoctorId = targetDoctors[inputIndex].id;
            session.selectedDoctorName = targetDoctors[inputIndex].name;
            session.currentState = 'SELECT_DATE_TIME';
            session.failedNluAttempts = 0;
          } else if (nluResult.entities.doctorName) {
            const matchDoctor = targetDoctors.find(d => d.name.includes(nluResult.entities.doctorName!));
            if (matchDoctor) {
              session.selectedDoctorId = matchDoctor.id;
              session.selectedDoctorName = matchDoctor.name;
              session.currentState = 'SELECT_DATE_TIME';
              session.failedNluAttempts = 0;
            } else {
              session.failedNluAttempts++;
            }
          } else {
            const matchDoctor = targetDoctors[0];
            session.selectedDoctorId = matchDoctor.id;
            session.selectedDoctorName = matchDoctor.name;
            session.currentState = 'SELECT_DATE_TIME';
          }

          // Tomorrow-First Slot Engine: Generate slots starting from TOMORROW with 1.2x Human Buffer Multiplier
          if (session.selectedDoctorId) {
            const doctor = tenant.doctors.find(d => d.id === session.selectedDoctorId || d.name === session.selectedDoctorName)!;
            const service = tenant.services.find(s => s.id === session.selectedServiceId || s.name === session.selectedServiceName);
            const tomorrowDate = SlotGenerator.getTomorrowDate();
            
            const slots = SlotGenerator.generateAvailableSlots(doctor, tomorrowDate, [], service?.durationMinutes || 30);
            
            if (slots.length > 0) {
              session.selectedSlot = slots[0];
              SlotGenerator.lockSlotTemporarily(slots[0]);
            }
          }
          break;

        case 'SELECT_DATE_TIME':
          // Check for polite exit / farewell
          if (messageText.includes('شكرا') || messageText.includes('شكراً') || messageText.includes('ما اريد') || messageText.includes('ما أريد') || messageText.includes('باي') || messageText.includes('لا تسوي') || messageText.includes('تصبح على خير')) {
            session.currentState = 'GREETING';
            return 'أهلاً وسهلاً بيك عيني! إذا غيرت رأيك أو احتاجيت أي حجز بـ أي وقت، إحنا بـ الخدمة وموجودين دائماً. يومك سعيد! 🌸';
          }

          // Working Hours Gate: Strict validation of requested time against doctor working hours
          const doctorForHours = tenant.doctors.find(d => d.id === session.selectedDoctorId || d.name === session.selectedDoctorName) || tenant.doctors[0];
          const timeMatch = messageText.match(/(\d{1,2})\s*(بالليل|مساءً|عصراً|صباحاً|PM|AM)?/i);

          if (timeMatch) {
            let reqHour = parseInt(timeMatch[1]);
            const period = timeMatch[2]?.toLowerCase() || '';

            if ((period.includes('ليل') || period.includes('مساء') || period.includes('عصر') || period.includes('pm')) && reqHour < 12) {
              reqHour += 12;
            }
            if ((period.includes('صباح') || period.includes('am')) && reqHour === 12) {
              reqHour = 0;
            }

            const { startHour, endHour } = doctorForHours.workingHours;
            if (reqHour < startHour || reqHour >= endHour) {
              const service = tenant.services.find(s => s.id === session.selectedServiceId || s.name === session.selectedServiceName);
              const validSlots = SlotGenerator.generateAvailableSlots(doctorForHours, SlotGenerator.getTomorrowDate(), [], service?.durationMinutes || 30);
              const slotTimes = validSlots.slice(0, 3).map(s => s.startTime).join(' ، ');

              return `عيني دكتور/دكتورة ${doctorForHours.name} متوفر في ${doctorForHours.branchName} من الساعة ${startHour > 12 ? startHour - 12 : startHour} صباحاً لغاية ${endHour > 12 ? endHour - 12 : endHour} عصراً فقط. 

المواعيد المتاحة الرسمية لغدٍ هي: (${slotTimes || 'من 9 صباحاً'}). أيهم تفضل ححجزه لك؟`;
            }
          }

          if (nluResult.intent === 'SELECT_SLOT' || nluResult.intent === 'CONFIRM' || session.selectedSlot) {
            // Zero-Reask CRM Protocol: Returning Patient Bypass!
            if (session.patientName) {
              session.currentState = 'CONFIRMATION_PENDING';
            } else {
              session.currentState = 'COLLECT_PATIENT_NAME';
            }
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
            session.bookingCode = `BK-${Math.floor(1000 + Math.random() * 9000)}`;

            const branch = tenant.branches.find(b => b.id === session.selectedBranchId || b.name === session.selectedBranchName) || tenant.branches[0];
            const doctor = tenant.doctors.find(d => d.id === session.selectedDoctorId || d.name === session.selectedDoctorName) || tenant.doctors[0];
            const service = tenant.services.find(s => s.id === session.selectedServiceId || s.name === session.selectedServiceName) || tenant.services[0];

            const defaultStartH = doctor.workingHours?.startHour || 9;
            const defaultStartTime = session.selectedSlot?.startTime || `${defaultStartH.toString().padStart(2, '0')}:00`;
            const effectiveDuration = Math.ceil((service.durationMinutes || 30) * 1.2);
            
            const [startH, startMin] = defaultStartTime.split(':').map(Number);
            const totalEndMin = (startH * 60 + (startMin || 0)) + effectiveDuration;
            const computedEndH = Math.floor(totalEndMin / 60).toString().padStart(2, '0');
            const computedEndM = (totalEndMin % 60).toString().padStart(2, '0');
            const defaultEndTime = session.selectedSlot?.endTime || `${computedEndH}:${computedEndM}`;

            const booking: Booking = {
              bookingCode: session.bookingCode,
              tenantId: tenant.tenantId,
              patientPhone: phone,
              patientName: session.patientName || 'مراجع كريم',
              patientTag: session.isReturningPatient ? 'RETURNING' : 'NEW',
              branchId: branch.id,
              branchName: branch.name,
              doctorId: doctor.id,
              doctorName: doctor.name,
              serviceId: service.id,
              serviceName: service.name,
              department: session.selectedDepartment || 'عام',
              date: session.selectedSlot?.date || SlotGenerator.getTomorrowDate(),
              startTime: defaultStartTime,
              endTime: defaultEndTime,
              durationMinutes: effectiveDuration,
              status: 'CONFIRMED',
              createdAt: new Date().toISOString()
            };

            // Calendar-First Fix: Lock in Google Calendar FIRST, then record in Google Sheets DB, Patients_CRM & Analytics!
            await GoogleCalendarService.syncAppointment(booking, doctor);
            await GoogleSheetsService.saveBooking(booking);
            await GoogleSheetsService.savePatientCRM({
              phoneNumber: phone,
              patientName: session.patientName || 'مراجع كريم',
              platform: 'WhatsApp',
              totalBookings: 1,
              lastVisitDate: booking.date
            });
            await GoogleSheetsService.logAnalytics('BOOKING_CONFIRMED', `Booking: ${booking.bookingCode}, Patient: ${booking.patientName}, Doctor: ${booking.doctorName}`);
          } else if (nluResult.intent === 'CANCEL') {
            if (session.selectedSlot) SlotGenerator.unlockSlot(session.selectedSlot);
            session.currentState = 'GREETING';
            await GoogleSheetsService.logAnalytics('BOOKING_CANCELLED', `Phone: ${phone}`);
            return 'تم إلغاء طلب الحجز بنجاح عيني. شوكت ما تحب تحجز احنا بانتظارك برحابة صدر.';
          }
          break;

        case 'CONFIRMED':
          session.currentState = 'GREETING';
          break;
      }

      // 6. Generate Iraqi Persona Response via Context Slicer
      const sliced = ContextSlicer.slice(session, tenant, messageText);
      responseText = await GeminiService.generateIraqiResponse(sliced, tenant);

      return responseText;
    } catch (error: any) {
      console.error('[System Exception Caught]:', error);

      // Automated System Error Logging to System_Logs (separated from patient Complaints)
      try {
        await GoogleSheetsService.logSystemError(
          `[خطأ نظام]: ${error.message || String(error)}`,
          phone,
          session?.patientName || 'مراجع كريم'
        );
      } catch (logErr) {
        console.error('[Automated Error Log Failed]:', logErr);
      }

      // Return Respectful Iraqi Arabic System Error Fallback Response
      return `عذراً عيني، حصل انقطاع مؤقت بالخدمة. تقدر تتواصل وتكمل حجزك مباشرة وية السكرتارية على الرقم المباشر: ${tenant.secretaryPhone || '07881015584'} خلال ساعات الدوام الرسمية.`;
    }
  }
}
