import assert from 'node:assert';
import { describe, it, mock, afterEach } from 'node:test';
import { GeminiService, ConductTurnResult, ConductTurnContext } from '../services/gemini.js';
import { GoogleSheetsService } from '../services/google-sheets.js';
import { GoogleCalendarService } from '../services/google-calendar.js';
import { DynamicSlotEngine } from '../core/dynamic-slot-engine.js';
import { getBaghdadTomorrow, addDays, formatDate } from '../utils/baghdad-time.js';
import { TenantConfig, Doctor, Booking } from '../types/booking.js';

const doctors: Doctor[] = [
  {
    id: 'doc_ali',
    branchId: 'br_karrada',
    branchName: 'الكرادة',
    name: 'د. علي',
    specialty: 'أسنان',
    services: ['s1', 's2'],
    calendarId: 'primary',
    workingDays: [0, 1, 2, 3, 4, 5, 6],
    workingHours: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 9, endHour: 11, slotDurationMinutes: 30 }
  },
  {
    id: 'd_sara',
    branchId: 'br_karrada',
    branchName: 'الكرادة',
    name: 'د. سارة',
    specialty: 'تجميل',
    services: ['s3'],
    calendarId: 'primary',
    workingDays: [0, 1, 2, 3, 4, 5, 6],
    workingHours: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 8, endHour: 10, slotDurationMinutes: 30 }
  }
];

function makeTenant(): TenantConfig {
  return {
    tenantId: 'test_tenant',
    clinicName: 'عيادة المختبر الطبية',
    secretaryPhone: '07881015584',
    branches: [
      { id: 'br_karrada', name: 'الكرادة', address: 'بغداد - الكرادة', phone: '07', locationLink: 'https://maps.test/karrada' },
      { id: 'br_mansour', name: 'المنصور', address: 'بغداد - المنصور', phone: '07', locationLink: 'https://maps.test/mansour' }
    ],
    services: [
      { id: 's1', name: 'كشفية عامة', type: 'عام', department: 'عام', price: 25000, durationMinutes: 30, preAppointmentInstructions: 'الوصول قبل 15 دقيقة' },
      { id: 's2', name: 'تنظيف الأسنان', department: 'أسنان', price: 60000, durationMinutes: 40, doctorName: 'د. علي' },
      { id: 's3', name: 'حشوة تجميلية', department: 'تجميل', price: 150000, durationMinutes: 60, doctorName: 'د. سارة' }
    ],
    doctors,
    departments: ['أسنان', 'تجميل', 'عام'],
    faqs: [{ question: 'شنو ساعة الدوام؟', answer: 'من 9 صباحاً لغاية 11 ظهراً' }]
  };
}

const tenant = makeTenant();

interface MockCluster {
  bookings: any[];
  capturedBookings: Booking[];
  savedToCrm: number;
  calendarSynced: number;
}

function freshCluster(): MockCluster {
  return { bookings: [], capturedBookings: [], savedToCrm: 0, calendarSynced: 0 };
}

function installMocks(cluster: MockCluster) {
  mock.method(GoogleSheetsService, 'lookupPatientCRM', async () => null);
  mock.method(GoogleSheetsService, 'clearCache', () => undefined);
  mock.method(GoogleSheetsService, 'fetchActiveBookings', async () => [...cluster.bookings]);
  mock.method(GoogleSheetsService, 'saveBooking', async (b: Booking) => {
    cluster.capturedBookings.push(b);
    return true;
  });
  mock.method(GoogleSheetsService, 'savePatientCRM', async () => {
    cluster.savedToCrm++;
    return true;
  });
  mock.method(GoogleSheetsService, 'logAnalytics', async () => true);
  mock.method(GoogleSheetsService, 'logComplaint', async () => true);
  mock.method(GoogleSheetsService, 'logSystemError', async () => true);
  mock.method(GoogleSheetsService, 'findActiveBookingByPhone', async () => null);
  mock.method(GoogleSheetsService, 'cancelBookingInSheet', async () => null);
  mock.method(GoogleCalendarService, 'syncAppointment', async () => {
    cluster.calendarSynced++;
    return 'evt-123';
  });
  mock.method(GoogleCalendarService, 'cancelAppointment', async () => true);
}

/** Intercept Gemini; the `bookingCommitted` receipt turn is auto-handled. */
function installConductor(handler: (ctx: ConductTurnContext) => Promise<ConductTurnResult> | ConductTurnResult) {
  mock.method(GeminiService, 'conductTurn', async (ctx: any): Promise<ConductTurnResult> => {
    if (ctx.bookingCommitted) {
      return {
        reply: 'تم تثبيت حجزك بنجاح عيني! تصل رسالة تأكيد كاملة بتفاصيل موعدك.',
        intent: 'answer',
        action: 'NONE',
        proposed: {}
      };
    }
    return await handler(ctx);
  });
}

const YES = /موافق|يناسبني|يناسب|نعم|أي|أكيد|تم|ثبت|اوكي|أوكي/;
const giveName = (msg: string) => (msg.match(/اسمي\s*([^،،]+)/)?.[1] || msg.match(/اسمه\s*([^،،]+)/)?.[1])?.trim() || null;

/**
 * Deterministic "assistant" implementing the concierge flow the prompt describes,
 * driven purely by the session state visible via ctx (mirrors what Gemini does):
 * branch -> service -> GET_SLOTS -> present -> name -> summary -> commit.
 */
function director(svcName = 'تنظيف الأسنان') {
  return (ctx: ConductTurnContext): ConductTurnResult => {
    const s = ctx.slots || {};
    const tool = ctx.toolResult || '';

    if (!s.branchName) {
      return { reply: 'أي فرع تفضل؟ الكرادة أو المنصور؟', intent: 'answer', action: 'NONE', proposed: { branchName: 'الكرادة' } };
    }

    if (!s.serviceName) {
      return { reply: 'زوّدني الخدمة المطلوبة', intent: 'answer', action: 'LIST_SERVICES', proposed: { department: 'أسنان', serviceName: svcName } };
    }

    // Summary stage comes FIRST (a pointer waiting for the final "نعم, ثبّت")
    if (ctx.awaitingFinalConfirm || tool.includes('ملخص')) {
      if (YES.test(ctx.userMessage) && !tool.includes('ملخص')) {
        return { reply: 'بثّت الحجز', intent: 'answer', action: 'COMMIT_BOOKING', proposed: {} };
      }
      return { reply: 'هذا ملخص الحجز.. نثبت كلشي تمام؟', intent: 'answer', action: 'NONE', proposed: {} };
    }

    if (!ctx.pendingProposal) {
      return { reply: 'أجيب لك المواعيد الحالية', intent: 'answer', action: 'GET_SLOTS', proposed: {} };
    }

    // A GET_SLOTS / conflict recursion handed us a tool result (slot list / alternatives):
    if (tool.includes('أقرب المواعيد') || tool.includes('البدائل')) {
      return { reply: 'أقرب موعد يتوفر لك قد عرضه النظام.. يناسبك؟', intent: 'answer', action: 'NONE', proposed: {} };
    }

    // Fresh user response to a pending proposal
    if (YES.test(ctx.userMessage)) {
      if (!s.patientName) {
        return { reply: 'يدير المصمم.. اسمك الثنائي؟', intent: 'confirm_slot', action: 'NONE', proposed: { patientName: giveName(ctx.userMessage) } };
      }
      return { reply: 'أثبت الحجز الآن', intent: 'answer', action: 'COMMIT_BOOKING', proposed: {} };
    }

    return { reply: 'ماكو مشكلة، شو تحب تغيّر؟', intent: 'decline_slot', action: 'NONE', proposed: {} };
  };
}

afterEach(() => {
  mock.restoreAll();
  DynamicSlotEngine.getSessionsStore().clear();
});

describe('Gemini conversation conductor (dynamic booking loop)', () => {
  it('fulfills the full happy path end-to-end', async () => {
    const cluster = freshCluster();
    installMocks(cluster);
    const phone = '07710000001';
    installConductor(director());

    const r1 = await DynamicSlotEngine.processMessage(phone, 'مرحبا', tenant);
    assert.match(r1, /الكرادة/);

    const r2 = await DynamicSlotEngine.processMessage(phone, 'أريد خدمة تنظيف الأسنان', tenant);
    // service applied -> GET_SLOTS ran -> a real proposal for tomorrow exists
    assert.match(r2, /يناسبك/);

    const r3 = await DynamicSlotEngine.processMessage(phone, 'نعم، موافق', tenant);
    assert.match(r3, /اسمك|اسمه/, 'should ask for the patient name before the summary');

    const r4 = await DynamicSlotEngine.processMessage(phone, 'تمام، اسمي علي حسن', tenant);
    assert.match(r4, /ملخص/, 'summary shown, asks for final confirmation');

    const r5 = await DynamicSlotEngine.processMessage(phone, 'نعم، أثبت الحجز', tenant);
    assert.match(r5, /تم تثبيت حجزك/);

    assert.strictEqual(cluster.capturedBookings.length, 1, 'exactly one booking committed');
    const b = cluster.capturedBookings[0];
    assert.strictEqual(b.branchName, 'الكرادة');
    assert.strictEqual(b.serviceName, 'تنظيف الأسنان');
    assert.strictEqual(b.patientName, 'علي حسن');
    assert.strictEqual(b.date, getBaghdadTomorrow());
    assert.strictEqual(b.department, 'أسنان');
    assert.ok(cluster.calendarSynced >= 1, 'calendar synced before sheet commit');
    assert.strictEqual(cluster.savedToCrm, 1, 'CRM upsert once');

    const sess = DynamicSlotEngine.getSessionsStore().get(phone);
    assert.strictEqual(sess?.status, 'COMPLETED_LOCKED');
  });

  it('silent validation guard rejects fabricated entities (no invented branch/service saved)', async () => {
    const cluster = freshCluster();
    installMocks(cluster);
    const phone = '07710000002';
    installConductor(async () => {
      return { reply: 'اقتراح الشيطان؟', intent: 'answer', action: 'GET_SLOTS', proposed: { branchName: 'فرع غير موجود خالص XYZ', serviceName: 'خدمة مختلقة تماماً 123' } };
    });
    await DynamicSlotEngine.processMessage(phone, 'أريد حجز', tenant);
    const session = DynamicSlotEngine.getSessionsStore().get(phone)!;
    assert.ok(!session.slots?.branchName, 'fabricated branch not applied');
    assert.ok(!session.slots?.serviceName, 'fabricated service not applied');
    assert.strictEqual(cluster.capturedBookings.length, 0);
  });

  it('slot taken at commit → apology, replacement staged, "ثبت الأقرب" commits it', async () => {
    const cluster = freshCluster();
    installMocks(cluster);
    const phone = '07710000003';
    installConductor(director());

    await DynamicSlotEngine.processMessage(phone, 'مرحبا', tenant);
    await DynamicSlotEngine.processMessage(phone, 'تنظيف الأسنان', tenant); // proposal at 09:00 (empty bookings)
    // slot now becomes contested: another patient books the exact time
    cluster.bookings = [{
      bookingCode: 'BK-CONF',
      doctorId: 'doc_ali',
      doctorName: 'د. علي',
      date: getBaghdadTomorrow(),
      startTime: '09:00',
      endTime: '09:36',
      status: 'CONFIRMED',
      patientPhone: '0770-other'
    }];

    // give the name (summary + awaitingFinalConfirm)
    await DynamicSlotEngine.processMessage(phone, 'تمام اسمي غازي محمد', tenant);
    // user confirms → commit → 09:00 already taken → apology + real alternative
    const afterCommit = await DynamicSlotEngine.processMessage(phone, 'نعم، ثبت', tenant);
    assert.match(afterCommit, /يناسبك/, 'apologises and offers an alternative');
    assert.strictEqual(cluster.capturedBookings.length, 0, 'nothing committed until user picks the replacement');
    const sess = DynamicSlotEngine.getSessionsStore().get(phone)!;
    assert.ok(sess.pendingProposal, 'replacement proposal staged');
    assert.notStrictEqual(sess.proposedSlot?.startTime, '09:00', 'replacement slot must differ from the taken one');
    assert.ok(sess.proposedSlot?.startTime, 'replacement slot has a valid startTime');

    const committed = await DynamicSlotEngine.processMessage(phone, 'ثبت الأقرب يا سارة', tenant);
    assert.match(committed, /تم تثبيت حجزك/);
    assert.strictEqual(cluster.capturedBookings.length, 1);
  });

  it('side question does not disturb the pending question', async () => {
    const cluster = freshCluster();
    installMocks(cluster);
    const phone = '07710000004';
    installConductor(async (ctx) => {
      const s = ctx.slots || {};
      if (!s.branchName) return { reply: 'أي فرع؟', intent: 'answer', action: 'NONE', proposed: { branchName: 'المنصور' } };
      if (/دوام|ساعات|ساعة/.test(ctx.userMessage)) {
        return { reply: 'دوامنا من 9.. نرجع لسؤالنا، أي فرع تختار؟', intent: 'side_question', action: 'NONE', proposed: {} };
      }
      return { reply: 'تمام؟', intent: 'answer', action: 'NONE', proposed: { serviceName: 'كشفية عامة' } };
    });

    await DynamicSlotEngine.processMessage(phone, 'مرحبا', tenant);
    const side = await DynamicSlotEngine.processMessage(phone, 'شنو ساعات الدوام؟', tenant);
    assert.match(side, /9|دوامنا/);

    const session = DynamicSlotEngine.getSessionsStore().get(phone)!;
    assert.ok(!session.slots?.branchName || !session.pendingProposal, 'branch question still pending');
    assert.ok(!session.awaitingFinalConfirm, 'final-confirm not reached');
    assert.strictEqual(cluster.capturedBookings.length, 0);
  });

  it('recommends the earliest available slot across multiple doctors', async () => {
    const cluster = freshCluster();
    installMocks(cluster);
    const phone = '07710000005';
    // service "كشفية عامة" has no pinned doctor → both الكرادة doctors eligible
    installConductor(async (ctx) => {
      const s = ctx.slots || {};
      if (!s.branchName) return { reply: '؟', intent: 'answer', action: 'NONE', proposed: { branchName: 'الكرادة' } };
      if (!s.serviceName) return { reply: '؟', intent: 'answer', action: 'LIST_SERVICES', proposed: { serviceName: 'كشفية عامة' } };
      if (!ctx.pendingProposal) return { reply: '؟', intent: 'answer', action: 'GET_SLOTS', proposed: {} };
      return { reply: 'اقترح', intent: 'answer', action: 'NONE', proposed: { serviceName: 'كشفية عامة' } };
    });

    await DynamicSlotEngine.processMessage(phone, 'السلام عليكم', tenant);
    await DynamicSlotEngine.processMessage(phone, 'أريد كشفية', tenant);
    const session = DynamicSlotEngine.getSessionsStore().get(phone)!;
    assert.strictEqual(session.proposedSlot?.startTime, '08:00', 'earliest slot is د. سارة at 08:00');
    assert.strictEqual(session.proposedSlot?.doctorName, 'د. سارة');
  });

  it('smart modify: keeps branch/service/doctor, only re-slots the time', async () => {
    const cluster = freshCluster();
    installMocks(cluster);
    const phone = '07710000006';
    let cancelledCode = '';
    let calendarCancelled = 0;

    const oldBooking: Booking = {
      bookingCode: 'BK-100',
      tenantId: 'test_tenant',
      patientPhone: phone,
      patientName: 'علي حسن',
      patientTag: 'RETURNING',
      branchId: 'br_karrada',
      branchName: 'الكرادة',
      doctorId: 'doc_ali',
      doctorName: 'د. علي',
      serviceId: 's2',
      serviceName: 'تنظيف الأسنان',
      department: 'أسنان',
      date: getBaghdadTomorrow(),
      startTime: '16:00',
      endTime: '16:36',
      durationMinutes: 36,
      status: 'CONFIRMED',
      createdAt: new Date().toISOString(),
      calendarEventId: 'evt-old',
      calendarId: 'primary'
    };

    mock.method(GoogleSheetsService, 'findActiveBookingByPhone', async () => oldBooking);
    mock.method(GoogleSheetsService, 'cancelBookingInSheet', async (code: string) => {
      cancelledCode = code;
      return oldBooking;
    });
    mock.method(GoogleCalendarService, 'cancelAppointment', async () => { calendarCancelled++; return true; });

    const reply = await DynamicSlotEngine.processMessage(phone, 'اريد اعدل حجزي خليها ب 5', tenant);

    assert.strictEqual(cancelledCode, 'BK-100', 'old booking cancelled');
    assert.strictEqual(calendarCancelled, 1, 'calendar event of old booking cancelled');
    assert.match(reply, /تم إلغاء حجزك السابق \(BK-100\)/);
    assert.match(reply, /نفس الفرع \(الكرادة\)/);
    assert.match(reply, /نفس الخدمة \(تنظيف الأسنان\)/);
    assert.match(reply, /نفس الطبيب/);

    const sess = DynamicSlotEngine.getSessionsStore().get(phone)!;
    assert.strictEqual(sess.status, 'IN_PROGRESS', 'no auto-restart of the routine');
    assert.strictEqual(sess.slots?.branchName, 'الكرادة', 'branch preserved');
    assert.strictEqual(sess.slots?.serviceName, 'تنظيف الأسنان', 'service preserved');
    assert.strictEqual(sess.slots?.doctorName, 'د. علي', 'doctor preserved');
    assert.strictEqual(sess.slots?.patientName, 'علي حسن', 'patient name preserved');
    assert.strictEqual(sess.slots?.department, 'أسنان', 'department preserved');
    assert.ok(sess.pendingProposal, 'new slot proposal staged for confirmation');
    assert.ok(sess.proposedSlot?.startTime, 'replacement slot proposed');
    assert.strictEqual(cluster.capturedBookings.length, 0, 'nothing re-committed without confirmation');
  });

  it('smart modify: "من 4 ل 6" keeps details and stages a new proposal', async () => {
    const cluster = freshCluster();
    installMocks(cluster);
    const phone = '07710000007';

    const oldBooking: Booking = {
      bookingCode: 'BK-101',
      tenantId: 'test_tenant',
      patientPhone: phone,
      patientName: 'ليث كريم',
      patientTag: 'RETURNING',
      branchId: 'br_karrada',
      branchName: 'الكرادة',
      doctorId: 'doc_ali',
      doctorName: 'د. علي',
      serviceId: 's2',
      serviceName: 'تنظيف الأسنان',
      department: 'أسنان',
      date: getBaghdadTomorrow(),
      startTime: '16:00',
      endTime: '16:36',
      durationMinutes: 36,
      status: 'CONFIRMED',
      createdAt: new Date().toISOString()
    };

    mock.method(GoogleSheetsService, 'findActiveBookingByPhone', async () => oldBooking);
    mock.method(GoogleSheetsService, 'cancelBookingInSheet', async () => oldBooking);

    const reply = await DynamicSlotEngine.processMessage(phone, 'اريد اعدل الوقت من 4 ل 6', tenant);
    assert.match(reply, /تم إلغاء حجزك السابق \(BK-101\)/);
    const sess = DynamicSlotEngine.getSessionsStore().get(phone)!;
    assert.strictEqual(sess.slots?.branchName, 'الكرادة');
    assert.strictEqual(sess.slots?.serviceName, 'تنظيف الأسنان');
    assert.strictEqual(sess.slots?.doctorName, 'د. علي');
    assert.ok(sess.pendingProposal);
  });

  it('cancel booking: confirmation only, no auto-restart', async () => {
    const cluster = freshCluster();
    installMocks(cluster);
    const phone = '07710000008';

    const oldBooking: Booking = {
      bookingCode: 'BK-200',
      tenantId: 'test_tenant',
      patientPhone: phone,
      patientName: 'علي حسن',
      patientTag: 'RETURNING',
      branchId: 'br_karrada',
      branchName: 'الكرادة',
      doctorId: 'doc_ali',
      doctorName: 'د. علي',
      serviceId: 's2',
      serviceName: 'تنظيف الأسنان',
      department: 'أسنان',
      date: getBaghdadTomorrow(),
      startTime: '16:00',
      endTime: '16:36',
      durationMinutes: 36,
      status: 'CONFIRMED',
      createdAt: new Date().toISOString()
    };

    mock.method(GoogleSheetsService, 'findActiveBookingByPhone', async () => oldBooking);
    mock.method(GoogleSheetsService, 'cancelBookingInSheet', async () => oldBooking);

    const reply = await DynamicSlotEngine.processMessage(phone, 'الغي حجزي', tenant);
    assert.match(reply, /تم إلغاء حجزك \(BK-200\)/);
    assert.doesNotMatch(reply, /أخبرني شنو|الخدمة أو الفرع/, 'must NOT start a new booking routine');
    assert.strictEqual(cluster.capturedBookings.length, 0);
    assert.ok(!DynamicSlotEngine.getSessionsStore().has(phone), 'session cleaned after cancel');
  });

  it('getSecretaryPhone: branch phone wins, then doctor, then tenant fallback', async () => {
    const s1 = {
      phoneNumber: 'x', tenantId: 'test_tenant', currentState: 'GREETING' as const,
      failedNluAttempts: 0, lastInteractionTime: Date.now(),
      slots: { branchId: 'br_karrada', branchName: 'الكرادة' }
    };
    assert.strictEqual((DynamicSlotEngine as any).getSecretaryPhone(s1, tenant), '07', 'branch phone used first');

    const s2 = { ...s1, slots: { doctorId: 'doc_ali', doctorName: 'د. علي' } };
    assert.strictEqual((DynamicSlotEngine as any).getSecretaryPhone(s2, tenant), '07881015584', 'doctor has no secretariatPhone → tenant fallback');

    const s3 = { ...s1, slots: {} };
    assert.strictEqual((DynamicSlotEngine as any).getSecretaryPhone(s3, tenant), '07881015584');
  });

  it('buildServiceList: clear message when branch has no matching services (no all-clinic fallback)', async () => {
    const session = {
      phoneNumber: 'y', tenantId: 'test_tenant', currentState: 'GREETING' as const,
      failedNluAttempts: 0, lastInteractionTime: Date.now(),
      slots: { branchId: 'br_mansour', branchName: 'المنصور', department: 'أسنان' }
    };
    const list = (DynamicSlotEngine as any).buildServiceList(session, tenant);
    assert.strictEqual(list.names.length, 0, 'no services at المنصور for أسنان');
    assert.match(list.text, /ماكو خدمات/);
    assert.match(list.text, /المنصور/);
    assert.doesNotMatch(list.text, /تنظيف الأسنان|حشوة/, 'must NOT leak services from other branches');
  });

  it('extractDesiredTime parses colloquial modify times', async () => {
    const x = (DynamicSlotEngine as any).extractDesiredTime;
    assert.strictEqual(x('خليها ب 5'), '17:00');
    assert.strictEqual(x('اريد نفسة بس اريد ساعة ب 6'), '18:00');
    assert.strictEqual(x('من 4 ل 6'), '18:00');
    assert.strictEqual(x('الساعة 9'), '09:00');
    assert.strictEqual(x('الساعة 5:30'), '17:30');
    assert.strictEqual(x('تمام'), null);
    assert.strictEqual(x(''), null);
  });

  it('COMPLETED_LOCKED: closing message without Gemini, and "حجز جديد" restarts', async () => {
    const cluster = freshCluster();
    installMocks(cluster);
    const phone = '07710000012';
    installConductor(director());

    // Complete a booking first
    await DynamicSlotEngine.processMessage(phone, 'مرحبا', tenant);
    await DynamicSlotEngine.processMessage(phone, 'تنظيف الأسنان', tenant);
    await DynamicSlotEngine.processMessage(phone, 'نعم، موافق', tenant);
    await DynamicSlotEngine.processMessage(phone, 'تمام، اسمي علي حسن', tenant);
    await DynamicSlotEngine.processMessage(phone, 'نعم أثبت', tenant);
    const sess = DynamicSlotEngine.getSessionsStore().get(phone)!;
    assert.strictEqual(sess.status, 'COMPLETED_LOCKED');

    // Ask about services after completion → closing message, Gemini NEVER called
    let geminiCalls = 0;
    installConductor(async () => { geminiCalls++; return { reply: '؟', intent: 'answer', action: 'GET_SLOTS', proposed: {} }; });
    const after = await DynamicSlotEngine.processMessage(phone, 'شنو خدماتكم', tenant);
    assert.match(after, /حجزك السابق/, 'must return closing, not Gemini tools');
    assert.strictEqual(geminiCalls, 0, 'Gemini must NOT be called for locked sessions');
    assert.strictEqual(cluster.capturedBookings.length, 1, 'no new booking created');

    // "حجز جديد" → resets locked session and restarts the routine
    installConductor(director());
    const restart = await DynamicSlotEngine.processMessage(phone, 'حجز جديد', tenant);
    const sess2 = DynamicSlotEngine.getSessionsStore().get(phone)!;
    assert.strictEqual(sess2.status, 'IN_PROGRESS', 'session unlocked');
    assert.match(restart, /الكرادة/, 'restart asks for branch again');
  });

  it('resolveSlotsForProposal: NO_DOCTOR + NO_SLOTS clear user messages', async () => {
    // كشفية عامة has no pinned doctor, and المنصور has no doctors at all → NO_DOCTOR
    const s1 = {
      phoneNumber: 'z', tenantId: 'test_tenant', currentState: 'GREETING' as const,
      failedNluAttempts: 0, lastInteractionTime: Date.now(),
      slots: { branchId: 'br_mansour', branchName: 'المنصور', serviceId: 's1', serviceName: 'كشفية عامة', department: 'عام' }
    };
    const res1 = (DynamicSlotEngine as any).resolveSlotsForProposal(s1, tenant, []);
    assert.strictEqual(res1.ok, false);
    assert.match(res1.text, /ماكو طبيب/, 'NO_DOCTOR message');

    // Block د. سارة's entire 7-day scan window (works 08:00-10:00, 60-min service) → NO_SLOTS
    const s2 = {
      phoneNumber: 'w', tenantId: 'test_tenant', currentState: 'GREETING' as const,
      failedNluAttempts: 0, lastInteractionTime: Date.now(),
      slots: { branchId: 'br_karrada', branchName: 'الكرادة', serviceId: 's3', serviceName: 'حشوة تجميلية', department: 'تجميل' }
    };
    const busy: any[] = [];
    let cursor = getBaghdadTomorrow();
    for (let i = 0; i < 7; i++) {
      busy.push({ bookingCode: `BK-${i}`, doctorId: 'd_sara', doctorName: 'د. سارة', date: cursor, startTime: '08:00', endTime: '10:00', status: 'CONFIRMED', patientPhone: 'x' });
      cursor = formatDate(addDays(new Date(cursor), 1));
    }
    const res2 = (DynamicSlotEngine as any).resolveSlotsForProposal(s2, tenant, busy);
    assert.strictEqual(res2.ok, false);
    assert.match(res2.text, /ما لقينا مواعيد شاغرة/, 'NO_SLOTS message');
  });
});