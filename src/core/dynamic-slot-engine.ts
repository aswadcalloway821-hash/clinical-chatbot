import { PatientSession, TenantConfig, BookingSlots, Booking, TimeSlot, BookedSlot, Doctor, Service, Branch, PromptContext } from '../types/booking.js';
import { GeminiService, ConductTurnResult, ConductTurnContext } from '../services/gemini.js';
import { HandoffManager } from '../services/handoff-manager.js';
import { SlotGenerator } from '../services/slot-generator.js';
import { GoogleSheetsService } from '../services/google-sheets.js';
import { GoogleCalendarService } from '../services/google-calendar.js';
import { getBaghdadToday, getBaghdadTomorrow, addDays, formatDate } from '../utils/baghdad-time.js';
import {
  normalizeArabicText, toAsciiDigits, interpretDayTerm, interpretTimeTerm,
  entityMentionScore, wordFuzzyScore, dateFromOffset
} from './interpretation.js';

const CANCEL_REGEX = /إلغاء الحجز|الغاء الحجز|الغي الحجز|أريد ألغي|إلغاء موعدي|الغاء موعدي|نلغي الحجز|إلغاء حجز|الغاء حجز|الغي حجزي|الغي موعدي|ألغي حجزي|االغي حجزي/i;
const MODIFY_REGEX = /تعديل الحجز|أغير الموعد|تغيير الموعد|عدل الموعد|تعديل موعدي|أغير وقت|تغيير وقت|أغير التاريخ|تعديل الوقت|تغيير الحجز|تعديل حجزي|عدل حجزي|عدل موعدي|اغير حجزي|اغير موعدي|اغير الوقت|اعدل حجزي|اعدل الموعد|تعدل حجزي/i;
const JUNK_NAME_RE = /^(undefined|null|none|لا يوجد|بدون|n\/a)$/i;
const CONFLICT_RE = /انحجز|امتلأت|قبل شوي|قبل قليل/i;
const MAX_CONDUCTOR_DEPTH = 4;

interface BookingResult {
  ok: boolean;
  message?: string;
  booking?: Booking;
  receiptText?: string;
}

export class DynamicSlotEngine {
  private static sessions: Map<string, PatientSession> = new Map();

  public static getSessionsStore(): Map<string, PatientSession> {
    return this.sessions;
  }

  /**
   * Helper to get Baghdad Today Date String (YYYY-MM-DD)
   */
  public static getBaghdadTodayDate(): string {
    return getBaghdadToday();
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
   * Resolve the branch-specific secretary phone: branch.phone → doctor.secretariatPhone → tenant.secretaryPhone
   */
  private static getSecretaryPhone(session: PatientSession, tenant: TenantConfig): string {
    const s = session?.slots || {};
    const branch = tenant.branches.find(b => b.id === s.branchId || b.name === s.branchName);
    if (branch?.phone) return branch.phone;
    const doctor = tenant.doctors.find(d => d.id === s.doctorId || d.name === s.doctorName);
    if (doctor?.secretariatPhone) return doctor.secretariatPhone;
    return tenant.secretaryPhone || '07881015584';
  }

  /**
   * Process incoming WhatsApp user message through the Gemini-driven conversation conductor.
   */
  public static async processMessage(
    phone: string,
    messageText: string,
    tenant: TenantConfig
  ): Promise<string> {
    const reply = await this._processMessage(phone, messageText, tenant);
    const session = this.sessions.get(phone);
    if (session) {
      if (!session.recentMessages) session.recentMessages = [];
      session.recentMessages.push({ role: 'bot', text: reply });
      if (session.recentMessages.length > 6) session.recentMessages = session.recentMessages.slice(-6);
    }
    return reply;
  }

  private static async _processMessage(
    phone: string,
    messageText: string,
    tenant: TenantConfig
  ): Promise<string> {
    const todayStr = getBaghdadToday();
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
        slots: { patientName: crmPatient?.patientName },
        patientName: crmPatient?.patientName,
        isReturningPatient: !!crmPatient,
        patientTag: crmPatient ? 'RETURNING' : 'NEW',
        failedNluAttempts: 0,
        lastInteractionTime: Date.now(),
        dailyMessageCount: 1,
        lastMessageDate: todayStr,
        hasWelcomed: true,
        recentMessages: [{ role: 'user', text: trimmedMsg }]
      };
      this.sessions.set(phone, newSession);
      const activeBookings = await GoogleSheetsService.fetchActiveBookings(todayStr);
      return this.runConductor(newSession, trimmedMsg, tenant, activeBookings, 'تم تصفير المحادثة وإعادة الضبط — رحبي بالزبون وابدئي روتين الحجز من أول سؤال (الفرع).', 0);
    }

    let session = this.sessions.get(phone);

    // Zero-Reask Protocol: First-Touch CRM Lookup
    if (!session) {
      const crmPatient = await GoogleSheetsService.lookupPatientCRM(phone);
      session = {
        phoneNumber: phone,
        tenantId: tenant.tenantId,
        currentState: 'GREETING',
        status: 'IN_PROGRESS',
        slots: { patientName: crmPatient?.patientName },
        patientName: crmPatient?.patientName,
        isReturningPatient: !!crmPatient,
        patientTag: crmPatient ? 'RETURNING' : 'NEW',
        failedNluAttempts: 0,
        lastInteractionTime: Date.now(),
        dailyMessageCount: 1,
        lastMessageDate: todayStr,
        hasWelcomed: false,
        recentMessages: []
      };
      this.sessions.set(phone, session);
    } else {
      if (session.lastMessageDate !== todayStr) {
        session.dailyMessageCount = 1;
        session.lastMessageDate = todayStr;
      } else {
        session.dailyMessageCount = (session.dailyMessageCount || 0) + 1;
      }
      // Re-lookup CRM if patientName missing
      if (!session.patientName || !session.slots?.patientName) {
        const crmPatient = await GoogleSheetsService.lookupPatientCRM(phone);
        if (crmPatient?.patientName) {
          session.patientName = crmPatient.patientName;
          session.isReturningPatient = true;
          session.patientTag = 'RETURNING';
          if (!session.slots) session.slots = {};
          session.slots.patientName = crmPatient.patientName;
        }
      }
    }

    // Rolling memory: remember the user's message (last 3 turns kept)
    if (!session.recentMessages) session.recentMessages = [];
    session.recentMessages.push({ role: 'user', text: trimmedMsg });
    if (session.recentMessages.length > 6) session.recentMessages = session.recentMessages.slice(-6);

    session.lastInteractionTime = Date.now();

    // 2. Daily Message Rate Limiter Shield
    if ((session.dailyMessageCount || 0) > dailyLimit) {
      return `عذراً عيني، وصلنا للحد الأقصى المسموح للرسائل اليومية. تقدر تتواصل مباشرة وية السكرتارية على هذا الرقم: ${this.getSecretaryPhone(session, tenant)} خلال ساعات الدوام الرسمية.`;
    }

    // Initialize slots object if undefined
    if (!session.slots) {
      session.slots = { patientName: session.patientName };
    }

    try {
      // 3. Voice Note Audio Transcription Support
      let processedText = messageText;
      if (messageText.startsWith('AUDIO_BASE64:')) {
        const audioBase64 = messageText.replace('AUDIO_BASE64:', '');
        processedText = await GeminiService.transcribeAudioNote(audioBase64);
        if (!processedText) {
          return `عفواً عيني، ما قدرنا نسمع البصمة الصوتية بوضوح. يرجى كتابة طلبك أو إعادة إرسال البصمة وتدلل!`;
        }
      }

      // 4. Cancel / Modify Booking Protocol (deterministic fast path, works in ANY state)
      const isCancelReq = CANCEL_REGEX.test(processedText);
      const isModifyReq = MODIFY_REGEX.test(processedText);
      if (isCancelReq || isModifyReq) {
        const handled = await this.handleCancelModify(session, phone, tenant, processedText, isCancelReq, isModifyReq);
        if (handled) return handled;
      }

      // 5. Load LIVE bookings once per message (zero double-booking guard)
      const activeBookings = await GoogleSheetsService.fetchActiveBookings(todayStr);

      // 6. Gemini conductor: free conversation, validated booking decisions
      console.log(`[DynamicEngine] Processing message for ${phone}: "${processedText.substring(0, 50)}"`);
      const result = await this.runConductor(session, processedText, tenant, activeBookings, null, 0);
      console.log(`[DynamicEngine] Reply for ${phone}: "${result.substring(0, 80)}"`);
      return result;

    } catch (error: any) {
      console.error('[DynamicSlotEngine Error]:', error?.message || error);
      console.error('[DynamicSlotEngine Error Stack]:', error?.stack);
      await GoogleSheetsService.logSystemError(`[DynamicEngine Error]: ${error.message || String(error)}`, phone, session?.patientName);
      return `عذراً عيني، حصل انقطاع مؤقت بالخدمة. تقدر تتواصل وتكمل حجزك مباشرة وية السكرتارية على الرقم المباشر: ${session ? this.getSecretaryPhone(session, tenant) : (tenant.secretaryPhone || '07881015584')} خلال ساعات الدوام الرسمية.`;
    }
  }

  // ------------------------------------------------------------------
  // Gemini conversation conductor loop
  // ------------------------------------------------------------------

  private static async runConductor(
    session: PatientSession,
    userMessage: string,
    tenant: TenantConfig,
    activeBookings: BookedSlot[],
    toolResult: string | null,
    depth: number,
    lastToolAction?: string
  ): Promise<string> {
    if (depth > MAX_CONDUCTOR_DEPTH) {
      await GoogleSheetsService.logSystemError(
        `[MAX_DEPTH] Conductor loop hit depth ${depth} for ${session.phoneNumber}. Last prompt: ${session.lastPrompt?.slotType || 'none'}. Message: "${userMessage.substring(0, 60)}"`,
        session.phoneNumber, session.patientName
      ).catch(() => {});
      return `عذراً عيني، صار تكرار بالردود شوي. حاول مرة ثانية أو تواصل مع السكرتارية على الرقم: ${this.getSecretaryPhone(session, tenant)}`;
    }

    const s = session.slots || {};
    session.slots = s;

    // ---- Early exit: COMPLETED_LOCKED sessions never hit Gemini ----
    if (session.status === 'COMPLETED_LOCKED') {
      if (/(حجز جديد|حجز ثاني|حجز اخر|حجز آخر|اريد حجز|أريد حجز|ابي حجز|أبي حجز|احجزلي|احجز لي|احجالي|أحجالي|نريد حجز|حجز باجر|حجز هم|حجز اضافي)/i.test(userMessage)) {
        // New booking request → reset the locked session and restart the routine
        session.status = 'IN_PROGRESS';
        session.pendingProposal = false;
        session.proposedSlot = undefined;
        session.awaitingFinalConfirm = false;
        session.lastPrompt = undefined;
        session.slots = { patientName: session.patientName };
        return this.runConductor(session, userMessage, tenant, activeBookings, 'الزبون يريد حجزاً جديداً — رحبي به وابدئي روتين الحجز من أول سؤال (الفرع).', depth + 1);
      }
      await GoogleSheetsService.logSystemError(
        `[COMPLETED_LOCKED] User "${session.patientName || ''}" asked "${userMessage.substring(0, 80)}" after booking completed`,
        session.phoneNumber, session.patientName
      ).catch(() => {});
      return `أهلاً وسهلاً بيك عيني! حجزك السابق مسجل ومؤكد. إذا حبيت تسوي حجز جديد أو نعدل الموعد، كليلي "حجز جديد" وندلل! 🌸`;
    }

    // Defensive: never let helper-crash take the whole conversation down
    let recommended: string | null = null;
    try {
      recommended = this.recommendedService(tenant, s);
    } catch (err: any) {
      console.error('[runConductor] recommendedService crashed:', err?.message || err);
    }

    const ctx: ConductTurnContext = {
      userMessage,
      tenant,
      slots: s,
      patientName: session.patientName || s.patientName,
      isReturning: !!session.isReturningPatient,
      recentMessages: session.recentMessages || [],
      pendingProposal: !!session.pendingProposal,
      proposedSlot: session.proposedSlot,
      awaitingFinalConfirm: !!session.awaitingFinalConfirm,
      optionsOffered: session.lastPrompt?.options,
      recommendedService: recommended,
      toolResult,
      lockedSession: false
    };

    console.log(`[runConductor] Calling conductTurn for ${session.phoneNumber} depth=${depth} intent=${session.lastPrompt?.slotType || 'none'}`);
    let cr: ConductTurnResult;
    try {
      cr = await GeminiService.conductTurn(ctx);
    } catch (err: any) {
      console.error('[runConductor] conductTurn CRASHED:', err?.message || err);
      console.error('[runConductor] conductTurn STACK:', err?.stack);
      return `عيني ما فهمتك زين، تفضل أعيد كلامك مرة ثانية وتدلل 🌸`;
    }
    console.log(`[runConductor] conductTurn returned: intent=${cr.intent} action=${cr.action} reply="${(cr.reply || '').substring(0, 60)}"`);

    // Deterministic exits Gemini may have detected
    if (cr.intent === 'cancel' || cr.intent === 'modify') {
      try {
        const handled = await this.handleCancelModify(session, session.phoneNumber, tenant, userMessage, cr.intent === 'cancel', cr.intent === 'modify');
        if (handled) return handled;
      } catch (err: any) {
        console.error('[runConductor] handleCancelModify crashed:', err?.message || err);
        await GoogleSheetsService.logSystemError(`[CANCEL_MODIFY_CRASH] ${err?.message || String(err)} for ${session.phoneNumber}`, session.phoneNumber, session.patientName).catch(() => {});
        return `عيني، صار خطأ مؤقت أثناء معالجة طلبك. حاول مرة ثانية وتدلل 🌸`;
      }
    }
    if (cr.intent === 'human') {
      console.log(`[runConductor] Intent=human, logging complaint and calling handoff for ${session.phoneNumber}`);
      await GoogleSheetsService.logComplaint({
        timestamp: new Date().toISOString(),
        patientName: session.patientName || 'مراجع كريم',
        phoneNumber: session.phoneNumber,
        complaintContent: userMessage,
        status: 'PENDING'
      });
      const handoffMsg = HandoffManager.executeHandoff(session, tenant);
      console.log(`[runConductor] Handoff message: "${handoffMsg.substring(0, 60)}"`);
      return handoffMsg;
    }

    // Apply Gemini's proposed values — validated against real clinic data
    console.log(`[runConductor] Applying proposed values:`, JSON.stringify(cr.proposed || {}).substring(0, 200));
    this.applyProposed(session, cr.proposed, tenant);
    console.log(`[runConductor] After applyProposed: slots=`, JSON.stringify({ branch: s.branchName, service: s.serviceName, doctor: s.doctorName, date: s.date, time: s.startTime, name: s.patientName }));

    // ---- Tool actions ----
    if (cr.action === 'LIST_SERVICES') {
      if (lastToolAction === 'LIST_SERVICES') {
        // LOOP GUARD: Gemini repeated the same tool → show the list directly to the USER
      const list = this.buildServiceList(session, tenant);
      if (list.names.length > 0) {
        session.lastPrompt = { slotType: 'service', options: list.names, question: 'اختر الخدمة' };
        return list.text;
      }
      return list.text;
    }
    const list = this.buildServiceList(session, tenant);
    if (list.names.length > 0) {
      session.lastPrompt = { slotType: 'service', options: list.names, question: 'اختر الخدمة' };
      return this.runConductor(session, userMessage, tenant, activeBookings, list.text, depth + 1, 'LIST_SERVICES');
    }
    return list.text;
  }

    if (cr.action === 'GET_SLOTS') {
      if (lastToolAction === 'GET_SLOTS') {
        // LOOP GUARD: Gemini repeated the same tool → show the slots directly to the USER
        const res = this.resolveSlotsForProposal(session, tenant, activeBookings);
        if (res.ok) {
          session.lastPrompt = { slotType: 'time', options: [], question: 'تأكيد الوقت' };
          session.proposedSlot = res.slot;
          session.pendingProposal = true;
          session.awaitingFinalConfirm = false;
          s.doctorId = res.slot.doctorId;
          s.doctorName = res.slot.doctorName || s.doctorName;
          s.date = res.slot.date;
          s.startTime = res.slot.startTime;
        }
        return res.text;
      }
      const res = this.resolveSlotsForProposal(session, tenant, activeBookings);
      if (res.ok) {
        session.lastPrompt = { slotType: 'time', options: [], question: 'تأكيد الوقت' };
        session.proposedSlot = res.slot;
        session.pendingProposal = true;
        session.awaitingFinalConfirm = false;
        s.doctorId = res.slot.doctorId;
        s.doctorName = res.slot.doctorName || s.doctorName;
        s.date = res.slot.date;
        s.startTime = res.slot.startTime;
      }
      return this.runConductor(session, userMessage, tenant, activeBookings, res.text, depth + 1, 'GET_SLOTS');
    }

    if (cr.action === 'RESET' || cr.action === 'COMMIT_BOOKING' || cr.intent === 'confirm_booking') {
      if (cr.action === 'RESET') {
        session.slots = { patientName: session.patientName };
        session.pendingProposal = false;
        session.proposedSlot = undefined;
        session.awaitingFinalConfirm = false;
        session.lastPrompt = undefined;
        return this.runConductor(session, userMessage, tenant, activeBookings, 'تم تصفير المحادثة — ابدئي روتين الحجز من أول سؤال (الفرع).', depth + 1);
      }
      // HARD GUARD: don't commit unless user has seen summary and explicitly confirmed
      // Exception: if pendingProposal=true (e.g. after conflict replacement), allow direct re-confirm
      if (!session.awaitingFinalConfirm && !session.pendingProposal) {
        if (lastToolAction === 'commit_guard') {
          // LOOP GUARD: Gemini kept trying to commit → present the summary directly
          session.awaitingFinalConfirm = true;
          return this.buildBookingSummary(session, tenant);
        }
        return this.runConductor(session, userMessage, tenant, activeBookings,
          'لا يمكن التثبيت بعد — يجب عرض الملخص النهائي والانتظار لتأكيد الزبون ("نعم ثبت") أولاً. أعيدي سؤال الملخص.', depth + 1, 'commit_guard');
      }
      return await this.commitBooking(session, session.phoneNumber, tenant, activeBookings, depth, lastToolAction);
    }

    // ---- Intent-level handling (action NONE) ----
    if (cr.intent === 'confirm_slot') {
      if (!s.patientName) {
        // Gemini already asked for the name in its reply
        return cr.reply;
      }
      session.awaitingFinalConfirm = true;
      if (lastToolAction === 'confirm_slot') {
        // LOOP GUARD: Gemini repeated confirm_slot → show the summary directly
        return this.buildBookingSummary(session, tenant);
      }
      const summary = this.buildBookingSummary(session, tenant);
      return this.runConductor(session, userMessage, tenant, activeBookings, summary, depth + 1, 'confirm_slot');
    }

    if (cr.intent === 'decline_slot' || cr.intent === 'decline_booking') {
      session.awaitingFinalConfirm = false;
      session.pendingProposal = false;
      session.proposedSlot = undefined;
      return cr.reply;
    }

    // side_question / greeting / answer / other → conversational reply only
    return cr.reply;
  }

  // ------------------------------------------------------------------
  // Validation guard: resolve Gemini's proposed values to REAL clinic entities
  // ------------------------------------------------------------------

  private static applyProposed(session: PatientSession, proposed: any, tenant: TenantConfig): void {
    const s = session.slots || {};
    session.slots = s;
    if (!proposed || typeof proposed !== 'object') return;

    if (proposed.branchName) {
      const b = this.matchBranch(String(proposed.branchName), tenant);
      if (b) {
        const changed = s.branchName !== b.name;
        s.branchName = b.name;
        s.branchId = b.id;
        if (changed) { session.pendingProposal = false; session.proposedSlot = undefined; session.awaitingFinalConfirm = false; }
      }
    }

    if (proposed.department) {
      const d = this.matchDepartment(String(proposed.department), tenant, s);
      if (d) s.department = d;
    }

    if (proposed.serviceName) {
      const srv = this.matchService(String(proposed.serviceName), tenant, s);
      if (srv) {
        const changed = s.serviceName !== srv.name;
        s.serviceName = srv.name;
        s.serviceId = srv.id;
        if (srv.department) s.department = srv.department;
        if (changed) {
          // service changed → downstream values (doctor/time) must be re-resolved
          s.doctorId = undefined;
          s.doctorName = undefined;
          session.pendingProposal = false;
          session.proposedSlot = undefined;
          session.awaitingFinalConfirm = false;
        }
      }
    }

    if (proposed.doctorName && !s.doctorName) {
      const doc = this.matchDoctor(String(proposed.doctorName), tenant, s);
      if (doc) { s.doctorId = doc.id; s.doctorName = doc.name; }
    }

    if (proposed.date && !s.date) {
      const day = interpretDayTerm(String(proposed.date));
      if (day && day.offset >= 1 && day.offset <= 30) {
        s.date = dateFromOffset(day.offset);
        session.pendingProposal = false;
        session.proposedSlot = undefined;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(String(proposed.date))) {
        s.date = String(proposed.date);
        session.pendingProposal = false;
        session.proposedSlot = undefined;
      }
    }

    if (proposed.time) {
      const tm = interpretTimeTerm(String(proposed.time));
      if (tm?.kind === 'exact') {
        s.startTime = `${String(tm.value.hh).padStart(2, '0')}:${String(tm.value.mm).padStart(2, '0')}`;
        session.preferredTimeRange = undefined;
        session.pendingProposal = false;
        session.proposedSlot = undefined;
      } else if (tm?.kind === 'range') {
        session.preferredTimeRange = tm.value;
        s.startTime = undefined;
        session.pendingProposal = false;
        session.proposedSlot = undefined;
      }
    }

    if (proposed.patientName && !s.patientName) {
      this.applyPatientName(session, String(proposed.patientName), tenant);
    }
  }

  private static matchBranch(raw: string, tenant: TenantConfig): Branch | null {
    const norm = normalizeArabicText(raw);
    let best: { b: Branch; score: number } | null = null;
    for (const b of tenant.branches) {
      const score = Math.max(
        entityMentionScore(b.name, norm),
        entityMentionScore(b.name.replace(/^فرع\s*/, ''), norm)
      );
      if (score > 0 && (!best || score > best.score)) best = { b, score };
    }
    return best && best.score >= 0.55 ? best.b : null;
  }

  private static matchDepartment(raw: string, tenant: TenantConfig, s: BookingSlots): string | null {
    const norm = normalizeArabicText(raw);
    const candidates = Array.from(new Set([
      ...(tenant.departments || []),
      ...this.branchDepartments(tenant, s.branchName, s.branchId)
    ])).filter(d => normalizeArabicText(d).length >= 2);
    let best: { name: string; score: number } | null = null;
    for (const d of candidates) {
      const score = entityMentionScore(d, norm);
      if (score > 0 && (!best || score > best.score)) best = { name: d, score };
    }
    return best && best.score >= 0.55 ? best.name : null;
  }

  private static matchService(raw: string, tenant: TenantConfig, s: BookingSlots): Service | null {
    const norm = normalizeArabicText(raw);
    let candidates = tenant.services;
    if (s.branchName) {
      const branchServices = tenant.services.filter(srv => {
        const doc = tenant.doctors.find(d => d.name === srv.doctorName || (srv.doctorName && (srv.doctorName.includes(d.name) || d.name.includes(srv.doctorName))));
        return doc ? doc.branchName === s.branchName || doc.branchId === s.branchId : true;
      });
      if (branchServices.length > 0) candidates = branchServices;
    }
    if (s.department) {
      const nd = normalizeArabicText(s.department);
      const deptServices = candidates.filter(srv => normalizeArabicText(srv.department || '') === nd);
      if (deptServices.length > 0) candidates = deptServices;
    }
    let best: { srv: Service; score: number } | null = null;
    for (const srv of candidates) {
      const score = entityMentionScore(srv.name, norm);
      if (score > 0 && (!best || score > best.score)) best = { srv, score };
    }
    return best && best.score >= 0.6 ? best.srv : null;
  }

  private static matchDoctor(raw: string, tenant: TenantConfig, s: BookingSlots): Doctor | null {
    const norm = normalizeArabicText(raw);
    let best: { d: Doctor; score: number } | null = null;
    for (const d of tenant.doctors) {
      const score = Math.max(
        entityMentionScore(d.name, norm),
        entityMentionScore(d.name.replace(/^(د\.?|دكتور|دكتورة)\s*/, ''), norm)
      );
      if (score > 0 && (!best || score > best.score)) best = { d, score };
    }
    if (!best || best.score < 0.55) return null;
    if (s.branchName) {
      const inBranch = best.d.branchName === s.branchName || best.d.branchId === s.branchId;
      if (!inBranch) return null;
    }
    return best.d;
  }

  /** Patient name — corroborated ONLY: every word evidenced in the user's text, never entity-like */
  private static applyPatientName(session: PatientSession, candidateRaw: string, tenant: TenantConfig): void {
    const s = session.slots || {};
    session.slots = s;
    if (s.patientName) return;
    const candidate = candidateRaw.trim();
    if (JUNK_NAME_RE.test(candidate)) return;

    const cNorm = normalizeArabicText(toAsciiDigits(candidate));
    const words = cNorm.split(/\s+/).filter(w => w.length >= 2);
    if (words.length === 0 || words.length > 4) return;

    // Reject if it matches a real entity name (a branch/service is not a person)
    const allEntityNames = [
      ...tenant.branches.map(b => b.name),
      ...tenant.services.map(sv => sv.name),
      ...tenant.doctors.map(d => d.name),
      ...(tenant.departments || [])
    ];
    const entityLike = allEntityNames.some(n => {
      const nn = normalizeArabicText(toAsciiDigits(n));
      return nn.length >= 3 && entityMentionScore(n, cNorm) >= 0.55;
    });
    if (entityLike) return;

    // Corroboration: every name word must appear in the user's own text
    const evWords = this.userEvidenceText(session, '').split(/\s+/).filter(w => w.length >= 2);
    const allPresent = words.every(w => evWords.some(ew => wordFuzzyScore(w, ew) >= 0.85));
    if (!allPresent) return;

    s.patientName = candidate;
    session.patientName = candidate;
  }

  /** All user texts in the rolling memory (last ~3 user messages) + optional current text */
  private static userEvidenceText(session: PatientSession, currentText: string): string {
    const users = (session.recentMessages || []).filter(t => t.role === 'user').map(t => t.text);
    return [...users, currentText].join(' ');
  }

  // ------------------------------------------------------------------
  // Dynamic helpers fed to Gemini (data only, no conversation control)
  // ------------------------------------------------------------------

  /** Dynamically pick a consultation-type service (generic concept keywords only) or the cheapest */
  private static recommendedService(tenant: TenantConfig, s: BookingSlots): string | null {
    const candidates = this.availableServicesFor(tenant, s);
    if (candidates.length === 0) return null;
    const concept = candidates.find(sv => /^(كشف|فحص|استشار|تشخيص|عرض)/.test(normalizeArabicText(sv.name)));
    if (concept) return concept.name;
    return [...candidates].sort((a, b) => a.price - b.price)[0].name;
  }

  private static buildServiceList(session: PatientSession, tenant: TenantConfig): { text: string; names: string[] } {
    const s = session.slots || {};
    const services = this.availableServicesFor(tenant, s);
    if (services.length === 0) {
      if (s.branchName && s.department) {
        return { names: [], text: `عيني، ماكو خدمات متاحة بقسم ${s.department} بفرع ${s.branchName} حالياً. تحب نشوفلك الخدمات بفرع ثاني أو قسم ثاني؟` };
      }
      if (s.branchName) {
        return { names: [], text: `عيني، ماكو خدمات متاحة حالياً بفرع ${s.branchName}. تحب نشوفلك الخدمات بفرع ثاني؟` };
      }
      return { names: [], text: 'عيني، ماكو خدمات متاحة حالياً. جرب فرع أو قسم ثاني وتدلل؟' };
    }
    const names = services.map(sv => sv.name);
    const lines = services.map((sv, i) => {
      const doc = tenant.doctors.find(d => d.name === sv.doctorName);
      return `${i + 1}. ${sv.name} - ${sv.price > 0 ? sv.price + ' دينار' : 'حسب الفحص'} (د. ${sv.doctorName || 'العيادة'}${doc ? ' - ' + doc.branchName : ''})`;
    });
    return { text: `قائمة الخدمات المتاحة حالياً — اختر رقم الخدمة المناسبة أو اكتب اسمها:\n${lines.join('\n')}`, names };
  }

  private static buildBookingSummary(session: PatientSession, tenant: TenantConfig): string {
    const s = session.slots || {};
    const branch = tenant.branches.find(b => b.id === s.branchId || b.name === s.branchName);
    const doctor = tenant.doctors.find(d => d.id === s.doctorId || d.name === s.doctorName);
    const service = tenant.services.find(sv => sv.id === s.serviceId || sv.name === s.serviceName);
    const dateLabel = s.date === getBaghdadTomorrow() ? 'غداً' : s.date;
    return `ملخص الحجز النهائي:
- الفرع: ${branch?.name || s.branchName || 'غير محدد'}
- القسم: ${s.department || 'عام'}
- الخدمة: ${service?.name || s.serviceName || 'غير محدد'}
- الطبيب: ${doctor?.name || s.doctorName || 'غير محدد'}
- الموعد: ${dateLabel || s.date} الساعة ${s.startTime || ''}
- الاسم: ${s.patientName || 'غير محدد'}
هل كلشي تمام ${s.patientName ? 'يا ' + s.patientName : 'عيني'}؟ اكتب "نعم" حتى نثبت الموعد نهائياً.`;
  }

  // ------------------------------------------------------------------
  // Tool: live slot resolution (single or multiple doctors → earliest)
  // ------------------------------------------------------------------

  private static resolveSlotsForProposal(
    session: PatientSession,
    tenant: TenantConfig,
    activeBookings: BookedSlot[]
  ): { ok: boolean; text: string; slot?: TimeSlot } {
    const s = session.slots || {};
    const service = tenant.services.find(sv => sv.id === s.serviceId || sv.name === s.serviceName);
    const duration = service?.durationMinutes || 30;

    let doctors: Doctor[] = [];
    if (s.doctorName) {
      const d = tenant.doctors.find(doc => doc.id === s.doctorId || doc.name === s.doctorName);
      if (d) doctors = [d];
    }
    if (doctors.length === 0 && service?.doctorName) {
      const d = tenant.doctors.find(doc => doc.name === service.doctorName! || doc.name.includes(service.doctorName!) || service.doctorName!.includes(doc.name));
      if (d) doctors = [d];
    }
    if (doctors.length === 0) {
      doctors = tenant.doctors.filter(d =>
        (!s.branchName || d.branchName === s.branchName || d.branchId === s.branchId) &&
        (!s.department || d.specialty?.includes(s.department) || tenant.services.some(sv => normalizeArabicText(sv.department || '') === normalizeArabicText(s.department || '') && (sv.doctorName === d.name || !sv.doctorName)))
      );
    }
    doctors = doctors.filter(Boolean);
    if (doctors.length === 0) {
      return { ok: false, text: `عيني، ماكو طبيب متاح بفرع ${s.branchName || 'المحدد'} لهذي الخدمة حالياً. تحب نغير الفرع أو نختارلك خدمة ثانية؟` };
    }

    const fromDate = s.date && s.date >= getBaghdadTomorrow() ? s.date : getBaghdadTomorrow();
    let best: { doc: Doctor; slot: TimeSlot } | null = null;
    const options: string[] = [];

    for (const doc of doctors) {
      let slots = this.earliestAvailableSlots(doc, fromDate, activeBookings, duration, 7, 3, session.preferredTimeRange);
      if (s.startTime) {
        const exact = slots.find(sl => sl.startTime === s.startTime);
        if (exact) {
          slots = [exact];
        } else {
          const anyDay = this.earliestAvailableSlots(doc, fromDate, activeBookings, duration, 14, 1);
          const near = anyDay.find(sl => sl.startTime === s.startTime);
          if (near) slots = [near];
        }
      }
      for (const sl of slots) {
        const label = `${sl.date === getBaghdadTomorrow() ? 'غداً' : sl.date} الساعة ${sl.startTime} مع ${doc.name}`;
        options.push(label);
        if (!best || (sl.date + sl.startTime) < (best.slot.date + best.slot.startTime)) best = { doc, slot: sl };
      }
    }

    if (!best) {
      GoogleSheetsService.logSystemError(
        `[NO_SLOTS] No free slots: doctor=${doctors.map(d => d.name).join(',')} from=${fromDate} branch=${s.branchName || ''}`,
        session.phoneNumber, session.patientName
      ).catch(() => {});
      return { ok: false, text: `حالياً ما لقينا مواعيد شاغرة بهالخدمة. جرب وقت ثاني أو تاريخ أبعد، أو تواصل مع السكرتارية 🌸` };
    }

    const uniqueOptions = Array.from(new Set(options)).slice(0, 3);
    return {
      ok: true,
      slot: { ...best.slot, doctorId: best.doc.id, doctorName: best.doc.name },
      text: `أقرب المواعيد المتاحة حالياً (حقيقية وبدون تعارض):
${uniqueOptions.join('\n')}
هل يناسبك أقرب موعد؟ اكتب "موافق" أو اختر الوقت المناسب.`
    };
  }

  private static branchDepartments(tenant: TenantConfig, branchName?: string, branchId?: string): string[] {
    const branchDoctors = tenant.doctors.filter(d => d.branchId === branchId || d.branchName === branchName);
    const branchServices = tenant.services.filter(s =>
      branchDoctors.some(d => d.name === s.doctorName || !s.doctorName)
    );
    const depts = Array.from(new Set(branchServices.map(s => s.department).filter(Boolean)));
    return depts.length > 0 ? depts : (tenant.departments || []);
  }

  private static availableServicesFor(tenant: TenantConfig, s: BookingSlots): Service[] {
    const normDept = (d?: string) => normalizeArabicText(d || '');
    let services = tenant.services;
    if (s.branchName || s.branchId) {
      const branchDocs = tenant.doctors.filter(d => d.branchId === s.branchId || d.branchName === s.branchName);
      // STRICT: if a branch is selected, only that branch's services are shown (never all-clinic fallback)
      services = tenant.services.filter(srv =>
        branchDocs.some(d => d.name === srv.doctorName || !srv.doctorName)
      );
    }
    if (s.department) {
      const deptServices = services.filter(srv => normDept(srv.department) === normDept(s.department));
      services = deptServices;
    }
    return services;
  }

  // ------------------------------------------------------------------
  // Commit path with hard guards + fresh re-check + warm receipt
  // ------------------------------------------------------------------

  private static async commitBooking(
    session: PatientSession,
    phone: string,
    tenant: TenantConfig,
    activeBookings: BookedSlot[],
    depth: number,
    lastToolAction?: string
  ): Promise<string> {
    const s = session.slots || {};

    // Hard completeness guard (real values only — never "undefined")
    const missing: string[] = [];
    if (!s.branchName) missing.push('الفرع');
    if (!s.serviceName) missing.push('الخدمة');
    if (!s.doctorName) missing.push('الطبيب');
    if (!s.patientName) missing.push('الاسم');
    if (!s.startTime && !session.proposedSlot) missing.push('الوقت');
    if (missing.length > 0) {
      await GoogleSheetsService.logSystemError(
        `[MISSING_FIELDS] Commit blocked for ${phone}: missing ${missing.join(', ')}. slots=${JSON.stringify(s)}`,
        phone, s.patientName
      ).catch(() => {});
      if (lastToolAction === 'commit_missing') {
        return `عيني، ما نثبت الموعد قبل ما نكمل بيانات الحجز. باقي إلنا: ${missing.join('، ')}. تفضل وياك كلشي يلي تحتاجه وتدلل 🌸`;
      }
      const note = `لا يمكن التثبيت بعد — ناقص من الزبون: ${missing.join('، ')}. اطلبي هذه المعلومات بهدوء قبل التثبيت.`;
      return this.runConductor(session, '', tenant, activeBookings, note, depth + 1, 'commit_missing');
    }

    const res = await this.finalizeBooking(session, phone, tenant);

    if (res.ok && res.booking) {
      session.awaitingFinalConfirm = false;
      return await this.receiptViaGemini(session, tenant, res.booking, res.receiptText || '');
    }

    // Slot was taken between proposal and commit → Gemini apologizes + offers real alternatives
    if (res.message && CONFLICT_RE.test(res.message)) {
      const fresh = await GoogleSheetsService.fetchActiveBookings(getBaghdadToday());
      // Clear time constraint so the resolver finds the truly earliest available slot (not the same time on a different day)
      s.startTime = undefined;
      const alt = this.resolveSlotsForProposal(session, tenant, fresh);
      if (alt.ok && alt.slot) {
        // stage the alternative so "ثبت الأقرب" commits it directly next turn
        session.proposedSlot = alt.slot;
        session.pendingProposal = true;
        session.awaitingFinalConfirm = false;
        s.doctorId = alt.slot.doctorId;
        s.doctorName = alt.slot.doctorName || s.doctorName;
        s.date = alt.slot.date;
        s.startTime = alt.slot.startTime;
      }
      const note = `الموعد الذي أردتِ تثبيته انحجز قبل شوي من مراجع آخر.
${alt.ok ? 'البدائل المتاحة حالياً:\n' + alt.text : alt.text}
اعتذري للزبون بصدق واعرضي عليه هذه البدائل (أو الأقرب إذا طلب "ثبت الأقرب").`;
      if (lastToolAction === 'commit_conflict') {
        return `عيني، هالموعد انحجز قبل شوي من مراجع آخر 😅.
${alt.ok ? 'البدائل المتاحة حالياً:\n' + alt.text : alt.text}
اكتب "ثبت الأقرب" حتى نثبت لك أول موعد شاغر.`;
      }
      return await this.runConductor(session, '', tenant, fresh, note, depth + 1, 'commit_conflict');
    }

    return res.message || `عذراً عيني، صار خلل تقني مؤقت أثناء تثبيت الحجز. تواصل مع السكرتارية: ${this.getSecretaryPhone(session, tenant)}`;
  }

  private static async receiptViaGemini(session: PatientSession, tenant: TenantConfig, booking: Booking, fallbackReceipt: string): Promise<string> {
    try {
      const receiptData = `تم تثبيت الحجز رسمياً في النظام قبل هذا الرد.
- كود الحجز: ${booking.bookingCode}
- الاسم: ${booking.patientName}
- رقم الهاتف: ${booking.patientPhone}
- الفرع: ${booking.branchName}
- القسم: ${booking.department || 'عام'}
- الخدمة: ${booking.serviceName}
- الطبيب: ${booking.doctorName}
- الموعد: ${booking.date} الساعة ${booking.startTime}
- الموقع: ${tenant.branches.find(b => b.name === booking.branchName)?.locationLink || 'داخل العيادة'}
تعليمات ما قبل الحضور: ${tenant.services.find(sv => sv.name === booking.serviceName)?.preAppointmentInstructions || 'يرجى الحضور قبل الموعد بـ 15 دقيقة مصحوباً بالهوية الشخصية.'}`;
      const cr = await GeminiService.conductTurn({
        userMessage: '',
        tenant,
        slots: session.slots || {},
        patientName: booking.patientName,
        isReturning: !!session.isReturningPatient,
        recentMessages: session.recentMessages || [],
        pendingProposal: false,
        proposedSlot: null,
        awaitingFinalConfirm: false,
        toolResult: receiptData,
        bookingCommitted: true
      });
      return cr.reply && cr.reply.length > 10 ? cr.reply : fallbackReceipt;
    } catch {
      return fallbackReceipt;
    }
  }

  // ------------------------------------------------------------------
  // Cancel / modify protocol (extracted, used by regex fast-path + Gemini intent)
  // ------------------------------------------------------------------

  private static async handleCancelModify(
    session: PatientSession,
    phone: string,
    tenant: TenantConfig,
    text: string,
    isCancelReq: boolean,
    isModifyReq: boolean
  ): Promise<string | null> {
    const activeBooking = await GoogleSheetsService.findActiveBookingByPhone(phone);
    if (!activeBooking) {
      await GoogleSheetsService.logSystemError(
        `[NO_ACTIVE_BOOKING] ${phone} requested ${isCancelReq ? 'cancel' : 'modify'} ("${text.substring(0, 50)}") but no active booking found`,
        phone, session.patientName
      ).catch(() => {});
      return `ما لقينا حجز نشط بهاد الرقم. إذا حبيت تحجز موعد جديد، كليلي الفرع والقسم ونباشر! 🌸`;
    }
    const cancelResult = await GoogleSheetsService.cancelBookingInSheet(activeBooking.bookingCode);
    if (cancelResult) {
      if (cancelResult.calendarEventId && cancelResult.calendarId) {
        await GoogleCalendarService.cancelAppointment(cancelResult.calendarId, cancelResult.calendarEventId);
      }
      await GoogleSheetsService.logAnalytics('BOOKING_CANCELLED', `Cancelled by patient: ${activeBooking.bookingCode}`);
    }
    if (session.selectedSlot) SlotGenerator.unlockSlot(session.selectedSlot);
    session.proposedSlot = undefined;
    session.pendingProposal = false;
    session.awaitingFinalConfirm = false;

    // ---- Cancel: confirm only, never auto-restart the booking routine ----
    if (isCancelReq && !isModifyReq) {
      if (!cancelResult) {
        return `عيني حاولنا نلغي الحجز لكود ${activeBooking.bookingCode} وبس صار خلل بالشبكة، راح نحولك لـ السكرتير للتأكيد المباشر.`;
      }
      this.sessions.delete(phone);
      return `تم إلغاء حجزك (${activeBooking.bookingCode}) بنجاح عيني. إذا حبيت تحجز موعد جديد بأي وقت، أنا بخدمتك وتدلل! 🌸`;
    }

    // ---- Smart Modify: keep branch/service/doctor, only re-slot the time ----
    if (!cancelResult) {
      return `عيني حاولنا نلغي الحجز لكود ${activeBooking.bookingCode} وبس صار خلل بالشبكة، راح نحولك لـ السكرتير للتأكيد المباشر.`;
    }

    // Preserve the OLD booking's real values so nothing has to be re-asked
    session.status = 'IN_PROGRESS';
    session.selectedSlot = undefined;
    session.selectedBranchId = activeBooking.branchId;
    session.selectedBranchName = activeBooking.branchName;
    session.selectedServiceId = activeBooking.serviceId;
    session.selectedServiceName = activeBooking.serviceName;
    session.selectedDoctorId = activeBooking.doctorId;
    session.selectedDoctorName = activeBooking.doctorName;
    session.slots = {
      branchId: activeBooking.branchId,
      branchName: activeBooking.branchName,
      department: activeBooking.department || 'عام',
      serviceId: activeBooking.serviceId,
      serviceName: activeBooking.serviceName,
      doctorId: activeBooking.doctorId,
      doctorName: activeBooking.doctorName,
      patientName: activeBooking.patientName
    };
    session.patientName = activeBooking.patientName;
    session.isReturningPatient = true;
    session.patientTag = 'RETURNING';
    session.lastPrompt = undefined;

    // Extract the desired new time from the user's text ("خليها ب 5", "من 4 ل 6", "الساعة 6")
    const desired = this.extractDesiredTime(text);
    if (desired) {
      session.slots.startTime = desired;
      session.preferredTimeRange = undefined;
    }

    const fresh = await GoogleSheetsService.fetchActiveBookings(getBaghdadToday());
    const res = this.resolveSlotsForProposal(session, tenant, fresh);
    if (res.ok && res.slot) {
      session.proposedSlot = res.slot;
      session.pendingProposal = true;
      session.awaitingFinalConfirm = false;
      session.slots.doctorId = res.slot.doctorId;
      session.slots.doctorName = res.slot.doctorName || session.slots.doctorName;
      session.slots.date = res.slot.date;
      session.slots.startTime = res.slot.startTime;
      session.lastPrompt = { slotType: 'time', options: [], question: 'تأكيد الوقت' };
      return `تم إلغاء حجزك السابق (${activeBooking.bookingCode}) لتعديل الموعد — وكل شي ثاني يبقى كما هو: نفس الفرع (${activeBooking.branchName}) ونفس الخدمة (${activeBooking.serviceName}) ونفس الطبيب.\n${res.text}`;
    }

    return `عيني، تم إلغاء حجزك السابق (${activeBooking.bookingCode}) وبس حالياً ما لقينا مواعيد شاغرة بنفس الخدمة (${activeBooking.serviceName}) بفرع ${activeBooking.branchName}. جرب تكوللي وقت ثاني أو تاريخ أبعد، وتدلل 🌸`;
  }

  /**
   * Extract a desired clock time from colloquial modify text:
   * "خليها ب 5" → 17:00, "من 4 ل 6" → 18:00, "الساعة 5:30" → 05:30,
   * "الساعة خمسة" → 17:00 (evening heuristic for bare hours 1-7).
   */
  private static extractDesiredTime(text: string): string | null {
    if (!text) return null;
    const norm = normalizeArabicText(toAsciiDigits(text));
    const toHHMM = (hh: number, mm = 0): string | null => {
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    };
    const pmHeuristic = (hh: number): number => (hh >= 1 && hh <= 7 ? hh + 12 : hh);

    // "من 4 ل 5" / "من 4 الي 6" → the NEW time is the second number
    const range = norm.match(/من\s*(\d{1,2})\s*(?:الي|الى|لـ|ل)\s*(\d{1,2})/);
    if (range) return toHHMM(pmHeuristic(parseInt(range[2], 10)));

    // Colloquial "خليها ب 5" / "على 5" / "غيره ل 6" / "للساعة 6" (+optional minutes)
    const bare = norm.match(/(?:ب|على|علي|الي|الى|لـ|للـ|لل)\s*(\d{1,2})(?:\s*[:.،]\s*(\d{2}))?/);
    if (bare) return toHHMM(pmHeuristic(parseInt(bare[1], 10)), bare[2] ? parseInt(bare[2], 10) : 0);

    // Explicit "الساعة 5" / "الساعة 5:30"
    const sa3a = norm.match(/(?:الساعه|ساعه)\s*(\d{1,2})(?:\s*[:.،]\s*(\d{2}))?/);
    if (sa3a) return toHHMM(pmHeuristic(parseInt(sa3a[1], 10)), sa3a[2] ? parseInt(sa3a[2], 10) : 0);

    // Word numbers: "الساعة خمسة" / "خمسة ونص"
    const tm = interpretTimeTerm(text);
    if (tm?.kind === 'exact') return toHHMM(tm.value.hh, tm.value.mm);

    return null;
  }

  // ------------------------------------------------------------------
  // Finalize: fresh re-check → atomic lock → calendar-first → sheet+CRM → receipt
  // ------------------------------------------------------------------

  private static async generateUniqueBookingCode(activeBookings: BookedSlot[]): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `BK-${Math.floor(10000 + Math.random() * 90000)}`;
      if (!activeBookings.some(b => b.bookingCode === code)) return code;
    }
    return `BK-${Date.now().toString().slice(-5)}`;
  }

  private static async finalizeBooking(session: PatientSession, phone: string, tenant: TenantConfig): Promise<BookingResult> {
    const s = session.slots || {};

    // ---- HARD GUARD: refuse to commit missing/placeholder values ----
    if (!s.patientName || ['undefined', 'null', ''].includes(String(s.patientName))) {
      return { ok: false, message: `تدلل عيني! بقى بس تزودنا بـ اسمك المحترم حتى نثبت الحجز ونصدر لك كارت الموعد الرسمي! 🌸` };
    }

    const branch = tenant.branches.find(b => b.id === s.branchId || b.name === s.branchName);
    const doctor = tenant.doctors.find(d => d.id === s.doctorId || d.name === s.doctorName);
    const service = tenant.services.find(srv => srv.id === s.serviceId || srv.name === s.serviceName);

    if (!branch || !doctor || !service || !s.startTime) {
      const missing: string[] = [];
      if (!branch) missing.push('الفرع');
      if (!service) missing.push('الخدمة');
      if (!doctor) missing.push('الطبيب');
      if (!s.startTime) missing.push('الوقت');
      return { ok: false, message: `لا يمكن التثبيت بعد — ناقص: ${missing.join('، ')}. يرجى تحديد كل الخيارات قبل التثبيت.` };
    }

    // ---- Fresh availability re-check + atomic lock at commit time (double-booking guard) ----
    const freshBookings = await GoogleSheetsService.fetchActiveBookings(getBaghdadToday());
    let slot = session.proposedSlot || session.selectedSlot;
    const bookingDate = s.date || slot?.date || getBaghdadTomorrow();

    if (!slot) {
      const slots = SlotGenerator.generateAvailableSlots(doctor, bookingDate, freshBookings, service?.durationMinutes || 30);
      slot = slots.find(sl => sl.startTime === s.startTime) || slots[0];
    }
    if (!slot) {
      return { ok: false, message: `عذراً عيني، هالموعد انحجز قبل قليل. أقرب موعد متاح إلك: ${this.slotListText(doctor, getBaghdadTomorrow(), freshBookings, service?.durationMinutes || 30)}` };
    }

    const startTime = s.startTime || slot.startTime;

    // Atomic lock: if someone else took this exact slot between proposal and commit -> propose next
    if (!SlotGenerator.lockSlotTemporarily(slot, undefined, phone)) {
      const next = this.earliestAvailableSlot(doctor, bookingDate, freshBookings, service?.durationMinutes || 30);
      if (next) {
        session.proposedSlot = next;
        session.pendingProposal = true;
        await GoogleSheetsService.logSystemError(
          `[SLOT_CONFLICT] ${phone} wanted ${bookingDate} ${startTime} (${doctor.name}) — taken, proposing ${next.date} ${next.startTime}`,
          phone, s.patientName
        ).catch(() => {});
        return { ok: false, message: `عيني هالوقت اللي طلبته انحجز قبل شوي 😅. أقرب موعد متاح إلك: ${next.date === getBaghdadTomorrow() ? 'غداً' : next.date} الساعة ${next.startTime}. تريد أحجزه إلك؟` };
      }
      return { ok: false, message: `عذراً عيني، المواعيد امتلأت فجأة. تواصل مع السكرتير لتثبيت موعد بديل: ${this.getSecretaryPhone(session, tenant)}` };
    }

    // If user-specified time no longer free (taken between proposal & commit) -> propose next
    const stillFree = SlotGenerator.generateAvailableSlots(doctor, bookingDate, freshBookings, service?.durationMinutes || 30, slot.slotId)
      .some(sl => sl.startTime === startTime);
    if (!stillFree) {
      const next = this.earliestAvailableSlot(doctor, bookingDate, freshBookings, service?.durationMinutes || 30);
      if (next) {
        session.proposedSlot = next;
        session.pendingProposal = true;
        await GoogleSheetsService.logSystemError(
          `[SLOT_CONFLICT] ${phone} wanted ${bookingDate} ${startTime} (${doctor.name}) — stillFree=false, proposing ${next.date} ${next.startTime}`,
          phone, s.patientName
        ).catch(() => {});
        return { ok: false, message: `عيني هالوقت اللي طلبته انحجز قبل شوي 😅. أقرب موعد متاح إلك: ${next.date === getBaghdadTomorrow() ? 'غداً' : next.date} الساعة ${next.startTime}. تريد أحجزه إلك؟` };
      }
      return { ok: false, message: `عذراً عيني، المواعيد امتلأت فجأة. تواصل مع السكرتير لتثبيت موعد بديل: ${this.getSecretaryPhone(session, tenant)}` };
    }

    // ---- Unique booking code ----
    session.bookingCode = await this.generateUniqueBookingCode(freshBookings);

    const effectiveDuration = Math.ceil((service.durationMinutes || 30) * 1.2);

    const [startH, startMin] = startTime.split(':').map(Number);
    const totalEndMin = (startH * 60 + (startMin || 0)) + effectiveDuration;
    const computedEndH = Math.floor(totalEndMin / 60).toString().padStart(2, '0');
    const computedEndM = (totalEndMin % 60).toString().padStart(2, '0');
    const computedEndTime = `${computedEndH}:${computedEndM}`;

    const booking: Booking = {
      bookingCode: session.bookingCode,
      tenantId: tenant.tenantId,
      patientPhone: phone,
      patientName: s.patientName,
      patientTag: session.isReturningPatient ? 'RETURNING' : 'NEW',
      branchId: branch?.id || 'b_1',
      branchName: branch?.name || 'الفرع الرئيسي',
      doctorId: doctor.id,
      doctorName: doctor.name,
      serviceId: service?.id || 's_1',
      serviceName: service?.name || 'كشفية عامة',
      department: s.department || 'عام',
      date: bookingDate,
      startTime,
      endTime: computedEndTime,
      durationMinutes: effectiveDuration,
      status: 'CONFIRMED',
      createdAt: new Date().toISOString(),
      calendarId: doctor.calendarId || 'primary'
    };

    // Calendar-First Sync Architecture: Sync Google Calendar FIRST, capture event ID for rollback & cancellation
    let calendarEventId: string | null = null;
    try {
      calendarEventId = await GoogleCalendarService.syncAppointment(booking, doctor);
      booking.calendarEventId = calendarEventId || undefined;
      if (!calendarEventId) {
        await GoogleSheetsService.logSystemError(`Calendar event NOT created for booking ${booking.bookingCode} (${booking.patientName} @ ${bookingDate} ${startTime})`, phone, booking.patientName);
      }
    } catch (calErr: any) {
      await GoogleSheetsService.logSystemError(`Calendar sync error for ${booking.bookingCode}: ${calErr?.message || String(calErr)}`, phone, booking.patientName);
    }

    // Atomic Commit to the Bookings sheet
    const saved = await GoogleSheetsService.saveBooking(booking);

    if (!saved) {
      // Rollback: delete the just-created calendar event (no orphan events in the doctor's calendar)
      if (calendarEventId && doctor?.calendarId) {
        await GoogleCalendarService.cancelAppointment(doctor.calendarId, calendarEventId);
      }
      await GoogleSheetsService.logSystemError(
        `[SAVE_FAILED] Booking ${booking.bookingCode} NOT saved to sheet for ${phone} (${booking.patientName} @ ${bookingDate} ${startTime})`,
        phone, booking.patientName
      );
      return { ok: false, message: `عذراً عيني، صار خلل تقني مؤقت أثناء تثبيت الحجز. تقدر تتواصل مع السكرتارية للتثبيت المباشر: ${this.getSecretaryPhone(session, tenant)}` };
    }

    // Update (or create) patient record in Patients_CRM — accumulates TotalBookings & LastVisitDate
    await GoogleSheetsService.savePatientCRM({
      phoneNumber: phone,
      patientName: booking.patientName,
      platform: 'WhatsApp',
      totalBookings: 1,
      lastVisitDate: booking.date
    });
    await GoogleSheetsService.logAnalytics('BOOKING_CONFIRMED', `Booking: ${booking.bookingCode}, Patient: ${booking.patientName}, Doctor: ${booking.doctorName}, Date: ${bookingDate} ${startTime}`);

    // Release the in-memory lock (the booking now lives in the sheet)
    SlotGenerator.unlockSlot(slot);

    // Set Session Status to COMPLETED_LOCKED
    session.status = 'COMPLETED_LOCKED';
    session.pendingProposal = false;
    session.proposedSlot = undefined;
    session.awaitingFinalConfirm = false;
    session.lastPrompt = undefined;

    const dateLabel = bookingDate === getBaghdadTomorrow() ? 'غداً' : bookingDate;

    const receiptText = `تم تثبيت حجزك بنجاح وبشكل نهائي عيني! ✅

📋 تفاصيل موعدك الرسمية:
- كود الحجز: ${booking.bookingCode}
- الاسم: ${booking.patientName}
- رقم الهاتف: ${phone}
- الفرع: ${booking.branchName}
- الطبيب: ${booking.doctorName}
- الخدمة: ${booking.serviceName}
- الموعد: ${dateLabel} ${bookingDate} الساعة ${startTime}

📍 موقع العيادة الجغرافي:
${branch?.locationLink || 'الفرع الرئيسي'}

⚠️ تعليمات وقائية قبل الحضور:
${service?.preAppointmentInstructions || 'يرجى الحضور قبل الموعد بـ 15 دقيقة مصحوباً بالهوية الشخصية.'}

تم تسجيل موعدك بالشيت والتقويم الرسمي ونرسل لك تذكير قبل الموعد. ننتظرك تنورنا بـ العيادة! 🌸`;

    return { ok: true, booking, receiptText };
  }

  private static availableSlotsOn(
    doctor: Doctor,
    date: string,
    activeBookings: BookedSlot[],
    duration: number
  ): TimeSlot[] {
    return SlotGenerator.generateAvailableSlots(doctor, date, activeBookings, duration);
  }

  private static slotListText(
    doctor: Doctor,
    fromDate: string,
    activeBookings: BookedSlot[],
    duration: number,
    scanDays: number = 3
  ): string {
    const slots = this.earliestAvailableSlots(doctor, fromDate, activeBookings, duration, scanDays);
    if (slots.length === 0) return 'لا توجد مواعيد شاغرة قريباً';
    return slots.map(sl => `${sl.date === getBaghdadTomorrow() ? 'غداً' : sl.date} الساعة ${sl.startTime}`).join(' ، ');
  }

  private static earliestAvailableSlots(
    doctor: Doctor,
    fromDate: string,
    activeBookings: BookedSlot[],
    duration: number,
    scanDays: number = 7,
    limit: number = 3,
    preferredRange?: { startMinute: number; endMinute: number }
  ): TimeSlot[] {
    const result: TimeSlot[] = [];
    const today = getBaghdadToday();
    let cursor = fromDate < today ? today : fromDate;
    let guard = 0;
    while (result.length < limit && guard < scanDays) {
      const slots = this.availableSlotsOn(doctor, cursor, activeBookings, duration);
      for (const sl of slots) {
        result.push(sl);
        if (result.length >= limit) break;
      }
      cursor = formatDate(addDays(new Date(cursor), 1));
      guard++;
    }
    if (preferredRange) {
      const inRange = result.filter(sl => {
        const [h, m] = sl.startTime.split(':').map(Number);
        const minute = h * 60 + (m || 0);
        return minute >= preferredRange.startMinute && minute + Math.ceil(duration * 1.2) <= preferredRange.endMinute;
      });
      const outRange = result.filter(sl => !inRange.includes(sl));
      return [...inRange, ...outRange];
    }
    return result;
  }

  private static earliestAvailableSlot(
    doctor: Doctor,
    fromDate: string,
    activeBookings: BookedSlot[],
    duration: number,
    preferredRange?: { startMinute: number; endMinute: number },
    excludeSlotId?: string
  ): TimeSlot | undefined {
    return this.earliestAvailableSlots(doctor, fromDate, activeBookings, duration, 7, 3, preferredRange)
      .find(sl => !excludeSlotId || sl.slotId !== excludeSlotId);
  }
}
