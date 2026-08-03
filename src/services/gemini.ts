import { GoogleGenerativeAI } from '@google/generative-ai';
import { NLUResult, TenantConfig, BookingSlots, TimeSlot, ConversationTurn } from '../types/booking.js';
import { getBaghdadTomorrow } from '../utils/baghdad-time.js';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

export class GeminiService {
  /**
   * Helper to clean any accidental markdown from text
   */
  private static cleanMarkdown(text: string): string {
    return text
      .replace(/\*/g, '')
      .replace(/#/g, '')
      .replace(/`/g, '')
      .replace(/_/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Build Dynamic System Instruction for Gemini based strictly on current Google Sheets Tenant Config
   */
  private static getSystemInstruction(tenant: TenantConfig): string {
    const branchNames = tenant.branches.map(b => b.name).join(' ، ');
    const doctorNames = tenant.doctors.map(d => d.name).join(' ، ');
    const deptNames = tenant.departments ? tenant.departments.join(' ، ') : '';

    return `
أنتِ "سارة الرقمية"، موظفة استقبال بشرية في "${tenant.clinicName}".

قواعد العمل والتجاوب المباشر:
1. اسم العيادة والمركز هو حصراً "${tenant.clinicName}".
2. الفروع والمواقع المتاحة هي حصراً: ${branchNames}.
3. الأقسام المتاحة هي: ${deptNames}.
4. الأطباء المتاحون هم حصراً: ${doctorNames}.
5. التحدث بلغة عراقية عفوية ومباشرة بدون رموز أو نجوم أو تنسيقات Markdown (*, **, #).
6. عدم إضافة أي عبارة ترحيب ختامية مكررة في نهاية الرد إطلاقاً.
`;
  }

  /**
   * Parse user intent and extract entities structured via JSON
   */
  public static async parseNluIntent(
    userMessage: string,
    currentState: string,
    tenant: TenantConfig
  ): Promise<NLUResult> {
    const prompt = `
أنت نظام استخراج النوايا والبيانات لدعم نظام حجز طبي لـ "${tenant.clinicName}".
تحليل رسالة المريض التالية واستخراج النية (intent) والكيانات (entities).

حالة الحوار الحالية: ${currentState}

الأقسام المتوفرة: ${JSON.stringify(tenant.departments || [])}
الفروع والمواقع المتاحة: ${JSON.stringify(tenant.branches.map(b => b.name))}
الخدمات المتوفرة: ${JSON.stringify(tenant.services.map(s => s.name))}
الأطباء المتوفرون: ${JSON.stringify(tenant.doctors.map(d => d.name))}

رسالة المريض: "${userMessage}"

قواعد اختيار النية (intent):
- إذا اختار قسماً طلياً -> intent: "SELECT_DEPARTMENT" والكيان departmentName
- إذا طلب موظف بشري أو شكوى أو تعبير عن الغضب شديد -> intent: "REQUEST_HUMAN" أو "ANGRY_EXPRESSION"
- إذا يسأل عن سعر أو موقع أو معلومة -> intent: "ASK_FAQ"
- إذا اختار فرعاً أو طبيباً أو خدمة -> اختر النية والكيان المناسب.
- إذا أعطى اسمه ثلاثياً -> intent: "PROVIDE_NAME" والكيان patientName
- إذا وافق أو أكد (نعم، اوكي، تم، اكيد، تأكيد) -> intent: "CONFIRM"
- إذا رفض أو الغى (لا، الغاء، تراجع) -> intent: "CANCEL"

أرجع نتيجة JSON فقط بالتنسيق التالي بدون أي نص إضافي:
{
  "intent": "GREETING | SELECT_DEPARTMENT | SELECT_BRANCH | SELECT_SERVICE | SELECT_DOCTOR | SELECT_SLOT | PROVIDE_NAME | CONFIRM | CANCEL | ASK_FAQ | REQUEST_HUMAN | ANGRY_EXPRESSION | UNKNOWN",
  "entities": {
    "departmentName": "اسم القسم أو undefined",
    "branchName": "اسم الفرع أو undefined",
    "serviceName": "اسم الخدمة أو undefined",
    "doctorName": "اسم الطبيب أو undefined",
    "slotId": "معرف الموعد أو undefined",
    "patientName": "اسم المريض أو undefined",
    "faqQuestion": "سؤال المريض أو undefined"
  },
  "confidence": 0.95
}
`;

    const modelsToTry = [
      process.env.GEMINI_MODEL || this.MODEL_FALLBACKS[0],
      ...this.MODEL_FALLBACKS.filter(m => m !== (process.env.GEMINI_MODEL || this.MODEL_FALLBACKS[0]))
    ];

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: this.getSystemInstruction(tenant),
          generationConfig: { responseMimeType: 'application/json' }
        });
        const response = await this.retryWithBackoff(() => model.generateContent(prompt));

        const text = response.response.text()?.trim() || '{}';
        const parsed = JSON.parse(text);

        return {
          intent: parsed.intent || 'UNKNOWN',
          entities: parsed.entities || {},
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8
        };
      } catch (error) {
        console.error(`[Gemini NLU] Model ${modelName} failed:`, error);
        continue;
      }
    }

    return { intent: 'UNKNOWN', entities: {}, confidence: 0.0 };
  }

  /**
   * Helper to get Current Baghdad Date String
   */
  public static getBaghdadDateString(): string {
    return new Date().toLocaleDateString('ar-IQ', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Baghdad'
    });
  }

  /**
   * Analyze and extract booking slots in one shot via Gemini NLU
   */
  public static async analyzeAndExtractSlots(
    userMessage: string,
    currentSlots: any,
    tenant: TenantConfig
  ): Promise<{ intent: string; extractedSlots: any; confidence: number }> {
    const prompt = `
أنتِ نظام تحليل النوايا واستخراج خانات الحجز الطبي لـ "${tenant.clinicName}".
تاريخ اليوم بتوقيت بغداد: ${this.getBaghdadDateString()}

بيانات العيادة المتاحة:
- الفروع: ${JSON.stringify(tenant.branches.map(b => ({ id: b.id, name: b.name })))}
- الأقسام: ${JSON.stringify(tenant.departments || [])}
- الخدمات: ${JSON.stringify(tenant.services.map(s => ({ id: s.id, name: s.name, department: s.department })))}
- الأطباء: ${JSON.stringify(tenant.doctors.map(d => ({ id: d.id, name: d.name, branch: d.branchName, specialty: d.specialty })))}

الخانات المسجلة حالياً: ${JSON.stringify(currentSlots || {})}
رسالة المريض الأخيرة: "${userMessage}"

المطلوب: استخراج أي معلومات حجز متوفرة في رسالة المريض (فرع، قسم، خدمة، طبيب، تاريخ، وقت، اسم المريض) وتعيين النية.
إذا كان السؤال استفساراً عاماً عن سعر أو موقع -> intent: "ASK_FAQ".
إذا كان طلب تحويل للسكرتير -> intent: "REQUEST_HUMAN".

أرجعي النتيجة بصيغة JSON فقط:
{
  "intent": "BOOKING_FLOW | ASK_FAQ | REQUEST_HUMAN | CANCEL_BOOKING | MODIFY_BOOKING",
  "extractedSlots": {
    "branchName": "اسم الفرع أو undefined",
    "branchId": "معرف الفرع أو undefined",
    "department": "اسم القسم أو undefined",
    "serviceName": "اسم الخدمة أو undefined",
    "serviceId": "معرف الخدمة أو undefined",
    "doctorName": "اسم الطبيب أو undefined",
    "doctorId": "معرف الطبيب أو undefined",
    "date": "التاريخ بصيغة YYYY-MM-DD أو undefined",
    "startTime": "الوقت بصيغة HH:mm أو undefined",
    "patientName": "اسم المريض الصريح الثلاثي أو الثنائي أو undefined"
  },
  "confidence": 0.95
}
`;

    try {
      const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.getSystemInstruction(tenant),
        generationConfig: { responseMimeType: 'application/json' }
      });
      const response = await model.generateContent(prompt);
      const parsed = JSON.parse(response.response.text()?.trim() || '{}');
      return {
        intent: parsed.intent || 'BOOKING_FLOW',
        extractedSlots: parsed.extractedSlots || {},
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9
      };
    } catch (err) {
      console.error('Gemini Slot Extraction Error:', err);
      return { intent: 'BOOKING_FLOW', extractedSlots: {}, confidence: 0.5 };
    }
  }

  /**
   * Generate polite closing response for locked sessions (COMPLETED_LOCKED)
   */
  public static async generatePoliteClosingResponse(userMessage: string, tenant: TenantConfig): Promise<string> {
    return `أهلاً وسهلاً بيك عيني! حجزك السابق مسجل ومؤكد عندنا بـ ${tenant.clinicName}. إذا حبيت تسوي حجز جديد أو نعدل الموعد كليلي "حجز جديد" وتدلل! 🌸`;
  }

  /**
   * Transcribe Audio Note (Voice Message) via Gemini Audio API
   */
  public static async transcribeAudioNote(audioBase64: string, mimeType: string = 'audio/ogg'): Promise<string> {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType,
            data: audioBase64
          }
        },
        { text: 'المطلوب: تحويل هذه البصمة الصوتية العربية العراقية إلى نص مكتوب بدقة، بدون أي إضافات.' }
      ]);
      return result.response.text()?.trim() || '';
    } catch (err) {
      console.error('Audio Transcription Error:', err);
      return '';
    }
  }

  /**
   * Answer FAQ dynamically based on Google Sheets TenantConfig
   */
  public static async answerFaq(userMessage: string, tenant: TenantConfig): Promise<string> {
    const prompt = `
سأل المريض السؤال التالي: "${userMessage}"

المعلومات الرسمية المتاحة لـ "${tenant.clinicName}":
الأسئلة الشائعة: ${JSON.stringify(tenant.faqs)}
الخدمات والأسعار: ${JSON.stringify(tenant.services)}
الفروع والمواقع المتاحة: ${JSON.stringify(tenant.branches)}

أجيبي عن سؤال المريض بلهجة عراقية عفوية جداً وبدون أي تنميق أو تنسيق Markdown، وبدون إضافة أي جملة ترحيب ختامية مكررة!
`;

    try {
      const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.getSystemInstruction(tenant)
      });
      const response = await model.generateContent(prompt);

      const reply = response.response.text() || '';
      return this.cleanMarkdown(reply);
    } catch (error) {
      return `تفضل عيني، يمكنك الاتصال بالسكرتارية لمعرفة كافة التفاصيل: ${tenant.secretaryPhone}.`;
    }
  }

  // ------------------------------------------------------------------
  // Conversation Conductor: Gemini controls the dialogue via prompt.
  // No fixed ladder, no hardcoded entity names — everything is injected
  // dynamically from the tenant data every turn.
  // ------------------------------------------------------------------

  public static readonly INTENTS = ['answer', 'side_question', 'confirm_slot', 'decline_slot', 'confirm_booking', 'decline_booking', 'cancel', 'modify', 'human', 'greeting', 'other'] as const;
  public static readonly ACTIONS = ['NONE', 'GET_SLOTS', 'LIST_SERVICES', 'COMMIT_BOOKING', 'RESET'] as const;

  /** Model fallback list: try primary, then fallbacks if overloaded (503) */
  private static readonly MODEL_FALLBACKS = [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash'
  ];

  /** Retry with exponential backoff for transient errors (503, 429, 500) */
  private static async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 2,
    baseDelayMs = 1000
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const isTransient = err?.status === 503 || err?.status === 429 || err?.status === 500;
        if (!isTransient || attempt === maxRetries) throw err;
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`[Gemini Retry] Attempt ${attempt + 1} failed (${err?.status}), retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error('Unreachable');
  }

  /** Validate reply is not garbled — must contain real Arabic words, not random numbers */
  private static isValidReply(reply: string): boolean {
    if (!reply || reply.length < 5) return false;
    // Check for garbled patterns: starts with phone number, mostly numbers, or gibberish
    if (/^\d{10,}/.test(reply)) return false;
    if (/^[0-9\s:،,.-]+$/.test(reply)) return false;
    // Check it contains at least some Arabic characters
    const arabicChars = (reply.match(/[\u0600-\u06FF]/g) || []).length;
    if (arabicChars < 3) return false;
    return true;
  }

  public static async conductTurn(ctx: ConductTurnContext): Promise<ConductTurnResult> {
    const prompt = this.buildConductorPrompt(ctx);
    const fallback: ConductTurnResult = {
      reply: 'عيني عذراً، صار انقطاع لحظي بالاتصال. تفضل أعيد كلامك مرة ثانية وتدلل 🌸',
      intent: 'other',
      action: 'NONE',
      proposed: {}
    };

    const modelsToTry = [
      process.env.GEMINI_MODEL || this.MODEL_FALLBACKS[0],
      ...this.MODEL_FALLBACKS.filter(m => m !== (process.env.GEMINI_MODEL || this.MODEL_FALLBACKS[0]))
    ];

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: this.getSystemInstruction(ctx.tenant),
          generationConfig: { responseMimeType: 'application/json' }
        });

        const response = await this.retryWithBackoff(() => model.generateContent(prompt));
        const text = response.response.text()?.trim() || '';
        const parsed = this.extractJson(text);
        if (!parsed) {
          console.warn(`[Gemini] Empty/invalid JSON from ${modelName}, trying next...`);
          continue;
        }

        const intent = this.INTENTS.includes(parsed.intent) ? parsed.intent : 'other';
        const action = this.ACTIONS.includes(parsed.action) ? parsed.action : 'NONE';
        const reply = this.cleanMarkdown(String(parsed.reply || ''));

        // Validate reply is not garbled
        if (!this.isValidReply(reply)) {
          console.warn(`[Gemini] Garbled reply from ${modelName}: "${reply.substring(0, 50)}...", trying next...`);
          continue;
        }

        return {
          reply: reply || fallback.reply,
          intent,
          action,
          proposed: (parsed.proposed && typeof parsed.proposed === 'object') ? parsed.proposed : {}
        };
      } catch (err: any) {
        console.error(`[Gemini] Model ${modelName} failed:`, err?.status || err?.message || err);
        continue;
      }
    }

    console.error('[Gemini] All models exhausted, returning fallback');
    return fallback;
  }

  /** Robust JSON extraction: strips fences and grabs the outermost {...} */
  private static extractJson(text: string): any | null {
    const cleaned = text.replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  /**
   * Build the conductor prompt dynamically from the CURRENT tenant data.
   * Contains ZERO hardcoded clinic entity names — every name, price, hour
   * comes from the live Google Sheets data at call time.
   */
  private static buildConductorPrompt(ctx: ConductTurnContext): string {
    const t = ctx.tenant;

    const branchList = t.branches.map(b => `- ${b.name}${b.address ? ' (' + b.address + ')' : ''}`).join('\n');

    const servicesList = t.services.map(s => `- ${s.name} | ${s.price > 0 ? s.price + ' دينار' : 'حسب الفحص'} | ${s.durationMinutes || 30} دقيقة | ${s.department || 'عام'}`).join('\n');

    const doctorsList = t.doctors.map(d => `- ${d.name} | ${d.branchName || d.branchId} | ${d.specialty || 'عام'}`).join('\n');

    const faqsText = (t.faqs || []).slice(0, 8).map(f => `س: ${f.question} | ج: ${f.answer}`).join('\n');

    // Current state (what the patient has already provided)
    const s = ctx.slots || {};
    const filled: string[] = [];
    if (s.branchName) filled.push(`الفرع: ${s.branchName}`);
    if (s.department) filled.push(`القسم: ${s.department}`);
    if (s.serviceName) filled.push(`الخدمة: ${s.serviceName}`);
    if (s.doctorName) filled.push(`الطبيب: ${s.doctorName}`);
    if (s.date) filled.push(`التاريخ: ${s.date}`);
    if (s.startTime) filled.push(`الوقت: ${s.startTime}`);
    const stateLine = filled.length ? filled.join(' | ') : 'لم يُحدد شيء بعد';

    let proposalLine = '';
    if (ctx.pendingProposal && ctx.proposedSlot) {
      proposalLine = `اقتراح موعد: ${ctx.proposedSlot.date} الساعة ${ctx.proposedSlot.startTime} مع ${ctx.proposedSlot.doctorName || s.doctorName || ''}`;
    }

    const recentTurns = (ctx.recentMessages || []).slice(-4).map(turn => `${turn.role === 'user' ? 'المريض' : 'سارة'}: ${turn.text}`).join('\n');

    const toolNote = ctx.toolResult ? `\nنتيجة النظام: ${ctx.toolResult}` : '';
    const optionsNote = ctx.optionsOffered?.length ? `\nقائمة الخيارات: ${ctx.optionsOffered.map((o, i) => `${i + 1}. ${o}`).join(' | ')}` : '';
    const committedNote = ctx.bookingCommitted ? '\nتم تثبيت الحجز — اكتفي رسالة تأكيد نهائية بالتفاصيل.' : '';

    return `
أنتِ "سارة"، موظفة استقبال في "${t.clinicName}". الوقت: ${this.getBaghdadDateString()} بتوقيت بغداد.

=== بيانات العيادة ===
الفرروع:
${branchList}

الخدمات:
${servicesList}

الأطباء:
${doctorsList}

${faqsText ? `أسئلة شائعة:\n${faqsText}` : ''}

=== حالة الحجز ===
${stateLine}
${proposalLine}
اسم المريض: ${ctx.patientName || 'لم يُسجل بعد'}
${optionsNote}
${toolNote}
${committedNote}

=== المحادثة ===
${recentTurns || 'بداية المحادثة'}
المريض: "${ctx.userMessage}"

=== القواعد ===
- تحدثي بالعراقي العفوي، بدون Markdown أو نجوم أو رموز.
- لا تختلقي فرع أو خدمة أو طبيباً غير موجود في البيانات أعلاه.
- أي سؤال جانبي (سعر، موقع، دوام): أجيبي باختصار ثم ارجعي للحجز.
- عند الغضب: اعتذار قصير ثم أعيدي السؤال بهدوء.
- لا تكرري نفس الصيغة في كل رد.

=== الروتين ===
1. الفرع → القسم → الخدمة → المواعيد → الاسم → ملخص → تأكيد → تثبيت

=== الرد JSON فقط ===
{
  "reply": "ردك بالعراقي",
  "intent": "answer | side_question | confirm_slot | decline_slot | confirm_booking | decline_booking | cancel | modify | human | greeting | other",
  "action": "NONE | GET_SLOTS | LIST_SERVICES | COMMIT_BOOKING | RESET",
  "proposed": {
    "branchName": null,
    "department": null,
    "serviceName": null,
    "doctorName": null,
    "date": null,
    "time": null,
    "patientName": null
  }
}

⚠️ COMMIT_BOOKING فقط بعد: الخدمة + الطبيب + الوقت + الاسم + ملخص + تأكيد صريح من المريض.
`;
  }
}

export interface ConductTurnContext {
  userMessage: string;
  tenant: TenantConfig;
  slots: BookingSlots;
  patientName?: string;
  isReturning: boolean;
  recentMessages: ConversationTurn[];
  pendingProposal: boolean;
  proposedSlot?: TimeSlot | null;
  awaitingFinalConfirm: boolean;
  optionsOffered?: string[];
  recommendedService?: string;
  toolResult?: string | null;
  justReset?: boolean;
  lockedSession?: boolean;
  bookingCommitted?: boolean;
}

export interface ConductTurnResult {
  reply: string;
  intent: 'answer' | 'side_question' | 'confirm_slot' | 'decline_slot' | 'confirm_booking' | 'decline_booking' | 'cancel' | 'modify' | 'human' | 'greeting' | 'other';
  action: 'NONE' | 'GET_SLOTS' | 'LIST_SERVICES' | 'COMMIT_BOOKING' | 'RESET';
  proposed: {
    branchName?: string;
    department?: string;
    serviceName?: string;
    doctorName?: string;
    date?: string;
    time?: string;
    patientName?: string;
  };
}
