import assert from 'node:assert';
import { describe, it, mock, afterEach } from 'node:test';
import { GeminiService, ConductTurnResult, ConductTurnContext } from '../services/gemini.js';
import { GoogleSheetsService } from '../services/google-sheets.js';
import { GoogleCalendarService } from '../services/google-calendar.js';
import { DynamicSlotEngine } from '../core/dynamic-slot-engine.js';
import { getBaghdadTomorrow } from '../utils/baghdad-time.js';
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
});