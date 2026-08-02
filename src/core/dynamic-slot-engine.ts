import { PatientSession, TenantConfig, BookingSlots, Booking, TimeSlot } from '../types/booking.js';
import { GeminiService } from '../services/gemini.js';
import { HandoffManager } from '../services/handoff-manager.js';
import { SlotGenerator } from '../services/slot-generator.js';
import { GoogleSheetsService } from '../services/google-sheets.js';
import { GoogleCalendarService } from '../services/google-calendar.js';

export class DynamicSlotEngine {
  private static sessions: Map<string, PatientSession> = new Map();

  public static getSessionsStore(): Map<string, PatientSession> {
    return this.sessions;
  }

  /**
   * Format operational working hours cleanly (12-hour format e.g., 9 صباحاً لـ 4 عصراً)
   */
  public static formatWorkingHours(startHour: number, endHour: number): string {
    const formatH = (h: number) => {
      const displayH = h % 12 || 12;
      const period = h >= 12 ? (h >= 17 ? 'مساءً' : 'عصراً') : 'صباحاً';
      return `${displayH} ${period}`;
    };
    return `${formatH(startHour)} لغاية ${formatH(endHour)}`;
  }

  /**
   * Helper to format dynamic branch departments list
   */
  public static getBranchDepartmentsList(tenant: TenantConfig): string {
    return tenant.branches.map((b, i) => {
      const branchDoctors = tenant.doctors.filter(d => d.branchId === b.id || d.branchName === b.name);
      const branchServices = tenant.services.filter(s =>
        branchDoctors.some(d => d.name === s.doctorName || !s.doctorName)
      );
      const branchDepts = Array.from(new Set(branchServices.map(s => s.department).filter(Boolean)));
      const deptStr = branchDepts.length > 0 ? branchDepts.join(' ، ') : (tenant.departments ? tenant.departments.join(' ، ') : 'عام');
      return `${i + 1}. فرع ${b.name} بيه قسم (${deptStr})`;
    }).join('\n');
  }

  /**
   * Process incoming WhatsApp user message through Dynamic Slot Engine
   */
  public static async processMessage(
    phone: string,
    messageText: string,
    tenant: TenantConfig
  ): Promise<string> {
    const todayStr = new Date().toISOString().split('T')[0];
    const dailyLimit = parseInt(process.env.DAILY_MESSAGE_LIMIT || '1000', 10);
    const trimmedMsg = messageText.trim();

    // 1. Explicit Reset Trigger ("تصفير" / "ريست" / "reset")
    const isExplicitReset = /^(تصفير|ريست|reset|إعادة ضبط)$/i.test(trimmedMsg);

    if (isExplicitReset) {
      this.sessions.delete(phone);
      GoogleSheetsService.clearCache();
      const crmPatient = await GoogleSheetsService.lookupPatientCRM(phone);
      const newSession: PatientSession = {
        phoneNumber: phone,
        tenantId: tenant.tenantId,
        currentState: 'GREETING',
        status: 'IN_PROGRESS',
        slots: {
          patientName: crmPatient?.patientName
        },
        patientName: crmPatient?.patientName,
        isReturningPatient: !!crmPatient,
        patientTag: crmPatient ? 'RETURNING' : 'NEW',
        failedNluAttempts: 0,
        lastInteractionTime: Date.now(),
        dailyMessageCount: 1,
        lastMessageDate: todayStr
      };
      this.sessions.set(phone, newSession);

      const branchDeptStr = this.getBranchDepartmentsList(tenant);
      return `تم تصفير المحادثة وإعادة الضبط بنجاح عيني. 🌸

صباح النور والسرور، نورت عيادة ${tenant.clinicName}. تدلل، هاي الفروع وأقسامها المتوفرة عندنا وبأي واحد تحب نحجزلك:

${branchDeptStr}

شوف أقرب فرع ويا قسم تحتاج وتدلل علمود أنطيك أقرب حجز، شنو الاختيار اللي يناسبك حتى نكمل باقي الإجراءات وياك؟`;
    }

    let session = this.sessions.get(phone);

    // First-Touch CRM Lookup
    if (!session) {
      const crmPatient = await GoogleSheetsService.lookupPatientCRM(phone);
      session = {
        phoneNumber: phone,
        tenantId: tenant.tenantId,
        currentState: 'GREETING',
        status: 'IN_PROGRESS',
        slots: {
          patientName: crmPatient?.patientName
        },
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
      if (session.lastMessageDate !== todayStr) {
        session.dailyMessageCount = 1;
        session.lastMessageDate = todayStr;
      } else {
        session.dailyMessageCount = (session.dailyMessageCount || 0) + 1;
      }
    }

    session.lastInteractionTime = Date.now();

    // 2. Daily Message Rate Limiter Shield
    if ((session.dailyMessageCount || 0) > dailyLimit) {
      return `عذراً عيني، وصلنا للحد الأقصى المسموح للرسائل اليومية. تقدر تتواصل مباشرة وية السكرتارية على هذا الرقم: ${tenant.secretaryPhone} خلال ساعات الدوام الرسمية.`;
    }

    // Initialize slots object if undefined
    if (!session.slots) {
      session.slots = { patientName: session.patientName };
    }

    // 3. Locked Session Protocol (COMPLETED_LOCKED)
    if (session.status === 'COMPLETED_LOCKED') {
      const isNewBookingReq = /حجز جديد|موعد ثاني|تعديل|أغير/i.test(trimmedMsg);
      if (isNewBookingReq) {
        session.status = 'IN_PROGRESS';
        session.slots = { patientName: session.patientName };
      } else {
        return await GeminiService.generatePoliteClosingResponse(trimmedMsg, tenant);
      }
    }

    try {
      // 4. Voice Note Audio Transcription Support
      let processedText = messageText;
      if (messageText.startsWith('AUDIO_BASE64:')) {
        const audioBase64 = messageText.replace('AUDIO_BASE64:', '');
        processedText = await GeminiService.transcribeAudioNote(audioBase64);
        if (!processedText) {
          return `عفواً عيني، ما قدرنا نسمع البصمة الصوتية بوضوح. يرجى كتابة طلبك أو إعادة إرسال البصمة وتدلل!`;
        }
      }

      // 5. Explicit Human Handoff Request
      const isExplicitHuman = /أريد أحكي ويا سكرتير|حولني على إنسان|أريد سكرتير|سكرتير/i.test(processedText);
      if (isExplicitHuman) {
        await GoogleSheetsService.logComplaint({
          timestamp: new Date().toISOString(),
          patientName: session.patientName || 'مراجع كريم',
          phoneNumber: phone,
          complaintContent: processedText,
          status: 'PENDING'
        });
        return HandoffManager.executeHandoff(session, tenant);
      }

      // 6. One-Shot NLU Multi-Slot Extraction
      const nluResult = await GeminiService.analyzeAndExtractSlots(processedText, session.slots, tenant);

      // Extract direct index number matching (1, 2, 3)
      const numMatch = processedText.match(/^(?:رقم\s*)?([1-9]\d*)$/);
      const inputIndex = numMatch ? parseInt(numMatch[1]) - 1 : -1;

      // Update extracted slots safely
      if (nluResult.extractedSlots) {
        if (nluResult.extractedSlots.branchName) session.slots.branchName = nluResult.extractedSlots.branchName;
        if (nluResult.extractedSlots.branchId) session.slots.branchId = nluResult.extractedSlots.branchId;
        if (nluResult.extractedSlots.department) session.slots.department = nluResult.extractedSlots.department;
        if (nluResult.extractedSlots.serviceName) session.slots.serviceName = nluResult.extractedSlots.serviceName;
        if (nluResult.extractedSlots.serviceId) session.slots.serviceId = nluResult.extractedSlots.serviceId;
        if (nluResult.extractedSlots.doctorName) session.slots.doctorName = nluResult.extractedSlots.doctorName;
        if (nluResult.extractedSlots.doctorId) session.slots.doctorId = nluResult.extractedSlots.doctorId;
        if (nluResult.extractedSlots.date) session.slots.date = nluResult.extractedSlots.date;
        if (nluResult.extractedSlots.startTime) session.slots.startTime = nluResult.extractedSlots.startTime;

        // Strict Patient Name Validation: Only set if NLU extracted a real 2-3 word human name
        if (nluResult.extractedSlots.patientName && nluResult.extractedSlots.patientName.length > 2 && !/قسم|فرع|حجز|خدمة|موعد/i.test(nluResult.extractedSlots.patientName)) {
          session.slots.patientName = nluResult.extractedSlots.patientName;
          session.patientName = nluResult.extractedSlots.patientName;
        }
      }

      // Handle Direct Index Selection when unselected
      if (inputIndex >= 0) {
        if (!session.slots.branchName && inputIndex < tenant.branches.length) {
          session.slots.branchId = tenant.branches[inputIndex].id;
          session.slots.branchName = tenant.branches[inputIndex].name;
        } else if (!session.slots.serviceName) {
          const deptServices = session.slots.department
            ? tenant.services.filter(s => s.department === session.slots.department)
            : tenant.services;
          const availServices = deptServices.length > 0 ? deptServices : tenant.services;
          if (inputIndex < availServices.length) {
            session.slots.serviceId = availServices[inputIndex].id;
            session.slots.serviceName = availServices[inputIndex].name;
          }
        }
      }

      // 7. Side-Questions Handling (ASK_FAQ) without Slot Destruction
      if (nluResult.intent === 'ASK_FAQ') {
        const faqAnswer = await GeminiService.answerFaq(processedText, tenant);
        const missingPrompt = this.getMissingSlotPrompt(session, tenant);
        return `${faqAnswer}\n\n${missingPrompt}`;
      }

      // 8. Auto-Resolve Single Branch / Service Gates
      if (!session.slots.branchName && session.slots.department) {
        const matchingBranches = tenant.branches.filter(b => {
          const deptServices = tenant.services.filter(s => s.department === session.slots.department);
          const deptDoctors = tenant.doctors.filter(d => deptServices.some(s => s.doctorName === d.name || !s.doctorName));
          return deptDoctors.some(d => d.branchName === b.name || d.branchId === b.id);
        });
        if (matchingBranches.length === 1) {
          session.slots.branchId = matchingBranches[0].id;
          session.slots.branchName = matchingBranches[0].name;
        }
      }

      if (!session.slots.serviceName && session.slots.department) {
        const deptServices = tenant.services.filter(s => s.department === session.slots.department);
        if (deptServices.length === 1) {
          session.slots.serviceId = deptServices[0].id;
          session.slots.serviceName = deptServices[0].name;
        }
      }

      // Auto-Resolve Doctor if only 1 doctor works in branch & department
      if (!session.slots.doctorName) {
        const branchDocs = tenant.doctors.filter(d =>
          (!session.slots?.branchId || d.branchId === session.slots.branchId || d.branchName === session.slots.branchName) &&
          (!session.slots?.department || d.specialty?.includes(session.slots.department) || tenant.services.some(s => s.department === session.slots.department && (s.doctorName === d.name || !s.doctorName)))
        );
        if (branchDocs.length === 1) {
          session.slots.doctorId = branchDocs[0].id;
          session.slots.doctorName = branchDocs[0].name;
        }
      }

      // Auto-Generate Earliest Slot if Doctor & Service are resolved
      if (!session.slots.startTime && session.slots.doctorName) {
        const doctor = tenant.doctors.find(d => d.id === session.slots?.doctorId || d.name === session.slots?.doctorName) || tenant.doctors[0];
        const service = tenant.services.find(s => s.id === session.slots?.serviceId || s.name === session.slots?.serviceName);
        const tomorrowDate = SlotGenerator.getTomorrowDate();
        const slots = SlotGenerator.generateAvailableSlots(doctor, tomorrowDate, [], service?.durationMinutes || 30);
        if (slots.length > 0) {
          session.slots.date = slots[0].date;
          session.slots.startTime = slots[0].startTime;
          session.selectedSlot = slots[0];
        }
      }

      // 9. Check if all required slots are present
      if (this.isAllSlotsFilled(session.slots)) {
        return await this.finalizeBooking(session, phone, tenant);
      }

      // 10. Generate Smart Prompt for Next Missing Slot
      return this.getMissingSlotPrompt(session, tenant);

    } catch (error: any) {
      console.error('[DynamicSlotEngine Error]:', error);
      await GoogleSheetsService.logSystemError(`[DynamicEngine Error]: ${error.message || String(error)}`, phone, session?.patientName);
      return `عذراً عيني، حصل انقطاع مؤقت بالخدمة. تقدر تتواصل وتكمل حجزك مباشرة وية السكرتارية على الرقم المباشر: ${tenant.secretaryPhone || '07881015584'} خلال ساعات الدوام الرسمية.`;
    }
  }

  /**
   * Check if all mandatory booking slots are filled
   */
  private static isAllSlotsFilled(slots: BookingSlots): boolean {
    return !!(
      (slots.branchName || slots.branchId) &&
      (slots.serviceName || slots.serviceId) &&
      (slots.doctorName || slots.doctorId) &&
      slots.startTime &&
      slots.patientName
    );
  }

  /**
   * Prompt for the single next missing slot cleanly
   */
  private static getMissingSlotPrompt(session: PatientSession, tenant: TenantConfig): string {
    const s = session.slots || {};

    if (!s.branchName && !s.department) {
      const branchDeptStr = this.getBranchDepartmentsList(tenant);
      return `صباح النور والسرور، نورت عيادة ${tenant.clinicName}. تدلل، هاي الفروع وأقسامها المتوفرة عندنا وبأي واحد تحب نحجزلك:

${branchDeptStr}

شوف أقرب فرع ويا قسم تحتاج وتدلل علمود أنطيك أقرب حجز، شنو الاختيار اللي يناسبك حتى نكمل باقي الإجراءات وياك؟`;
    }

    if (!s.serviceName) {
      const deptServices = s.department
        ? tenant.services.filter(srv => srv.department === s.department)
        : tenant.services;
      const availServices = deptServices.length > 0 ? deptServices : tenant.services;
      const servicesList = availServices.map((srv, i) => `${i + 1}. ${srv.name}${srv.price > 0 ? ` - ${srv.price} دينار` : ''}`).join('\n\n');

      return `تفضل عيني، هاي خيارات الخدمات المتاحة عندنا:

${servicesList}

(ونرجح لك كشفية واستشارة عامة كخيار أول لتشخيص الاحتياج الدقيق). شنو الخدمة اللي تحب تختارها؟`;
    }

    if (!s.doctorName) {
      const branchDocs = tenant.doctors.filter(d =>
        (!s.branchId || d.branchId === s.branchId || d.branchName === s.branchName)
      );
      const targetDocs = branchDocs.length > 0 ? branchDocs : tenant.doctors;
      const docsList = targetDocs.map((d, i) => `${i + 1}. دكتور/دكتورة ${d.name} (${d.specialty})`).join('\n');

      return `تفضل عيني، الأطباء المتاحون في ${s.branchName || 'الفرع'}:

${docsList}

أيهم تفضل تحجز عنده؟`;
    }

    if (!s.startTime) {
      const doctor = tenant.doctors.find(d => d.id === s.doctorId || d.name === s.doctorName) || tenant.doctors[0];
      const hoursStr = this.formatWorkingHours(doctor.workingHours.startHour, doctor.workingHours.endHour);
      return `عيني دكتور/دكتورة ${doctor.name} متوفر في ${doctor.branchName} خلال أوقات الدوام الرسمية (${hoursStr}). 

شنو الوقت المناسب لك غداً حتى أثبته لك؟`;
    }

    if (!s.patientName) {
      return `تدلل عيني! بقى بس تزودنا بـ اسمك المحترم حتى نثبت الحجز ونصدر لك كارت الموعد الرسمي! 🌸`;
    }

    return `تفضل عيني، كليلي شنو التفاصيل اللي تحب نوضحها لك؟`;
  }

  /**
   * Finalize Booking: Create Record, Sync Calendar, Save Sheet CRM, Issue Digital Receipt Card & Lock Session
   */
  private static async finalizeBooking(session: PatientSession, phone: string, tenant: TenantConfig): Promise<string> {
    session.bookingCode = `BK-${Math.floor(1000 + Math.random() * 9000)}`;
    const s = session.slots || {};

    const branch = tenant.branches.find(b => b.id === s.branchId || b.name === s.branchName) || tenant.branches[0];
    const doctor = tenant.doctors.find(d => d.id === s.doctorId || d.name === s.doctorName) || tenant.doctors[0];
    const service = tenant.services.find(srv => srv.id === s.serviceId || srv.name === s.serviceName) || tenant.services[0];

    const defaultStartH = doctor.workingHours?.startHour || 9;
    const defaultStartTime = s.startTime || `${defaultStartH.toString().padStart(2, '0')}:00`;
    const effectiveDuration = Math.ceil((service.durationMinutes || 30) * 1.2);

    const [startH, startMin] = defaultStartTime.split(':').map(Number);
    const totalEndMin = (startH * 60 + (startMin || 0)) + effectiveDuration;
    const computedEndH = Math.floor(totalEndMin / 60).toString().padStart(2, '0');
    const computedEndM = (totalEndMin % 60).toString().padStart(2, '0');
    const computedEndTime = `${computedEndH}:${computedEndM}`;

    const bookingDate = s.date || SlotGenerator.getTomorrowDate();

    const booking: Booking = {
      bookingCode: session.bookingCode,
      tenantId: tenant.tenantId,
      patientPhone: phone,
      patientName: s.patientName || session.patientName || 'مراجع كريم',
      patientTag: session.isReturningPatient ? 'RETURNING' : 'NEW',
      branchId: branch.id,
      branchName: branch.name,
      doctorId: doctor.id,
      doctorName: doctor.name,
      serviceId: service.id,
      serviceName: service.name,
      department: s.department || 'عام',
      date: bookingDate,
      startTime: defaultStartTime,
      endTime: computedEndTime,
      durationMinutes: effectiveDuration,
      status: 'CONFIRMED',
      createdAt: new Date().toISOString()
    };

    // Calendar-First Fix: Sync Calendar & Sheet
    await GoogleCalendarService.syncAppointment(booking, doctor);
    await GoogleSheetsService.saveBooking(booking);
    await GoogleSheetsService.savePatientCRM({
      phoneNumber: phone,
      patientName: booking.patientName,
      platform: 'WhatsApp',
      totalBookings: 1,
      lastVisitDate: booking.date
    });
    await GoogleSheetsService.logAnalytics('BOOKING_CONFIRMED', `Booking: ${booking.bookingCode}, Patient: ${booking.patientName}, Doctor: ${booking.doctorName}`);

    // Set Session Status to COMPLETED_LOCKED
    session.status = 'COMPLETED_LOCKED';

    return `تم تثبيت حجزك بنجاح وبشكل نهائي عيني! ✅

📋 تفاصيل موعدك:
- الاسم: ${booking.patientName}
- رقم الهاتف: ${phone}
- الفرع: ${branch.name}
- الطبيب: ${doctor.name}
- الخدمة: ${service.name}
- الموعد: غداً ${booking.date} الساعة ${defaultStartTime}
- كود الحجز: ${booking.bookingCode}

📍 رابط خريطة العيادة الجغرافي:
${branch.locationLink || 'الفرع الرئيسي'}

⚠️ تعليمات هامة قبل الحضور: ${service.preAppointmentInstructions || 'يرجى الحضور قبل الموعد بـ 15 دقيقة مصحوباً بالهوية الشخصية.'}

ننتظرك تنورنا بـ العيادة! 🌸`;
  }
}
