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

    try {
      const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.getSystemInstruction(tenant),
        generationConfig: { responseMimeType: 'application/json' }
      });
      const response = await model.generateContent(prompt);

      const text = response.response.text()?.trim() || '{}';
      const parsed = JSON.parse(text);

      return {
        intent: parsed.intent || 'UNKNOWN',
        entities: parsed.entities || {},
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8
      };
    } catch (error) {
      console.error('Gemini NLU Error:', error);
      return {
        intent: 'UNKNOWN',
        entities: {},
        confidence: 0.0
      };
    }
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

  public static async conductTurn(ctx: ConductTurnContext): Promise<ConductTurnResult> {
    const prompt = this.buildConductorPrompt(ctx);
    const fallback: ConductTurnResult = {
      reply: 'عيني عذراً، صار انقطاع لحظي بالاتصال. تفضل أعيد كلامك مرة ثانية وتدلل 🌸',
      intent: 'other',
      action: 'NONE',
      proposed: {}
    };

    try {
      const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.getSystemInstruction(ctx.tenant),
        generationConfig: { responseMimeType: 'application/json' }
      });
      const response = await model.generateContent(prompt);
      const text = response.response.text()?.trim() || '';
      const parsed = this.extractJson(text);
      if (!parsed) return fallback;

      const intent = this.INTENTS.includes(parsed.intent) ? parsed.intent : 'other';
      const action = this.ACTIONS.includes(parsed.action) ? parsed.action : 'NONE';
      return {
        reply: this.cleanMarkdown(String(parsed.reply || '')) || fallback.reply,
        intent,
        action,
        proposed: (parsed.proposed && typeof parsed.proposed === 'object') ? parsed.proposed : {}
      };
    } catch (err) {
      console.error('Gemini Conductor Error:', err);
      return fallback;
    }
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

    const branchDepts = t.branches.map(b => {
      const bDocs = t.doctors.filter(d => d.branchId === b.id || d.branchName === b.name);
      const depts = Array.from(new Set(t.services.filter(s => bDocs.some(d => d.name === s.doctorName || !s.doctorName)).map(s => s.department).filter(Boolean)));
      return `${b.name}${b.address ? ' - ' + b.address : ''} — الأقسام: ${depts.length ? depts.join(' ، ') : 'عام'}`;
    }).join('\n');

    const servicesText = t.services.map(s => {
      const doc = t.doctors.find(d => d.name === s.doctorName);
      return `- ${s.name} | السعر: ${s.price > 0 ? s.price + ' دينار' : 'حسب الفحص'} | المدة: ${s.durationMinutes || 30} دقيقة | القسم: ${s.department || 'عام'}${s.doctorName ? ' | الطبيب: ' + s.doctorName + (doc ? ' (' + doc.branchName + ')' : '') : ''}`;
    }).join('\n');

    const doctorsText = t.doctors.map(d => {
      const days = (d.workingHours?.days || []).map(n => ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][n]).join('، ');
      return `- ${d.name} | الفرع: ${d.branchName || d.branchId} | التخصص: ${d.specialty || 'عام'} | الدوام: ${days || 'يومياً'} من ${d.workingHours?.startHour ?? 9} إلى ${d.workingHours?.endHour ?? 17}`;
    }).join('\n');

    const faqsText = (t.faqs || []).slice(0, 12).map(f => `س: ${f.question} | ج: ${f.answer}`).join('\n');

    // Current state (what the patient has already provided)
    const s = ctx.slots || {};
    const filled: string[] = [];
    if (s.branchName) filled.push(`الفرع: ${s.branchName}`);
    if (s.department) filled.push(`القسم: ${s.department}`);
    if (s.serviceName) filled.push(`الخدمة: ${s.serviceName}`);
    if (s.doctorName) filled.push(`الطبيب: ${s.doctorName}`);
    if (s.date) filled.push(`التاريخ: ${s.date}`);
    if (s.startTime) filled.push(`الوقت: ${s.startTime}`);
    const stateLine = filled.length ? filled.join(' ، ') : 'لا يوجد أي اختيار بعد';

    let proposalLine = '';
    if (ctx.pendingProposal && ctx.proposedSlot) {
      proposalLine = `تم عرض اقتراح موعد على الزبون: ${ctx.proposedSlot.date === getBaghdadTomorrow() ? 'غداً' : ctx.proposedSlot.date} الساعة ${ctx.proposedSlot.startTime} مع ${ctx.proposedSlot.doctorName || s.doctorName || ''}`;
    }
    const finalLine = ctx.awaitingFinalConfirm ? 'الزبون وافق على الوقت وأنت الآن في مرحلة الملخص النهائي — انتظر تأكيده الأخير ("تمام/أكيد/ثبت") قبل طلب التثبيت.' : '';

    const recentTurns = (ctx.recentMessages || []).slice(-6).map(turn => `${turn.role === 'user' ? 'الزبون' : 'سارة'}: ${turn.text}`).join('\n');

    const toolNote = ctx.toolResult
      ? `\nنتيجة عملية قام بها النظام للتو (استخدميها حرفياً ولا تبدليها):\n${ctx.toolResult}`
      : '';

    const recNote = ctx.recommendedService ? `الخدمة المقترحة كخيار سريع: ${ctx.recommendedService}` : '';

    const optionsNote = ctx.optionsOffered && ctx.optionsOffered.length
      ? `آخر قائمة عرضتها على الزبون (بأرقام): ${ctx.optionsOffered.map((o, i) => `${i + 1}. ${o}`).join(' | ')} — إذا رد الزبون برقم فقط، قابليه بهذه القائمة.`
      : '';

    const committedNote = ctx.bookingCommitted
      ? 'لقد تم تثبيت الحجز رسمياً في النظام قبل هذا الرد — اكتبي الآن رسالة التأكيد النهائية الدافئة (الوصل) بالتفاصيل التالية حرفياً.'
      : '';

    return `
أنتِ "سارة الرقمية"، موظفة استقبال حقيقية في "${t.clinicName}".
الآن: ${this.getBaghdadDateString()} (بتوقيت بغداد).

=== بيانات العيادة الرسمية (المصدر الوحيد — لا تختلقي أي معلومة خارجها) ===
هاتف السكرتير: ${t.secretaryPhone || 'غير متوفر'}
الفروع:
${branchDepts}
الخدمات:
${servicesText}
الأطباء:
${doctorsText}
الأسئلة الشائعة:
${faqsText || 'لا توجد أسئلة مسجلة'}
${recNote}

=== حالة الحجز الحالية ===
${stateLine}
${proposalLine}
${finalLine}
الاسم المسجل: ${ctx.patientName || 'لم يُعطَ بعد'}${ctx.isReturning ? ' (زبون عائد)' : ''}
${optionsNote}
${toolNote}
${committedNote}

=== آخر المحادثة ===
${recentTurns || 'بداية المحادثة'}

رسالة الزبون الأخيرة: "${ctx.userMessage}"

=== شخصيتك وقواعد الرد ===
1. لهجة عراقية عفوية مهذبة، كلمات قصيرة وطبيعية، بدون Markdown وبدون تكرار جملة ختامية أو افتتاحية — كل رد يجب أن يكون مختلف عن سابقه ولا تكرري نفس الصيغة.
2. لا تختلقي أبداً فرعاً أو خدمة أو طبيباً أو سعراً غير موجود في "بيانات العيادة الرسمية" أعلاه — اعتمديها حصراً.
3. لا زيارات منزلية، لا تكسي/توصيل، لا قبول هدايا أو بقشيش — اعتذري بلطف وارجعي الموضوع للحجز.
4. عند الغضب أو الشتائم أو الاعتراض: اعتذار قصير صادق بدون جدال، ثم أعيدي السؤال الحالي بهدوء.
5. أي سؤال جانبي (سعر، موقع، دوام، دكتور، خدمة، أي استفسار عن العيادة والحجز): أجيبي باختصار ثم ارجعي لموضوع الحجز بطريقة مختلفة كل مرة (لا تكرري نفس الجملة).
6. إذا الرسالة غامضة ("؟" أو إيموجي فقط أو كلمة وحيدة): اعتذري بلطف واطلبي توضيح السؤال الحالي بلا انزعاج.
7. لا تستخدمي "تفضل عيني" أو "كليلي شنو" أو "التفاصيل اللي تحب نوضحها" كجمل افتتاحية أو ختامية — اختاري صيغة مختلفة كل مرة.

=== روتين الحجز (نفذيه بنفسك بمرونة) ===
1. إذا لم يُحدد الفرع بعد: اسألي الزبون أي فرع يفضل (اعرضي الفروع أعلاه بأقسامها).
2. بعد الفرع: اسألي القسم إذا كان مطلوباً.
3. بعد الفرع والقسم: اقترحي حجز الكشفية/الفحص العام (الخدمة المقترحة أعلاه إن وجدت) عشان الدكتور يحدد احتياجه بالضبط، أو اعرضي قائمة الخدمات.
4. بعد اختيار الخدمة: اطلبي action "GET_SLOTS" ليجلب لك المواعيد الحقيقية، ثم اعرضي أقرب موعد (اليوم والساعة والطبيب) واسألي "يناسبك؟".
5. بعد موافقة الزبون على الوقت: إذا ما نعرف اسمه اسأليه الاسم الثنائي؛ بعدها اعرضي ملخص الحجز الكامل واسألي "نثبت كلشي تمام؟".
6. عند تأكيد الزبون النهائي (تمام/أكيد/ثبت/نعم): اطلبي action "COMMIT_BOOKING".
7. عندما يبلغك النظام بالتثبيت (bookingCommitted): اكتبي وصل التأكيد النهائي الدافئ بكل التفاصيل + تعليمات ما قبل الحضور.

=== قرارك لهذه الرسالة: أرجعي JSON فقط ===
{
  "reply": "ردك الكامل لهذه الرسالة بالعراقي (إذا action غير NONE يمكن أن يكون رداً انتقالياً قصيراً)",
  "intent": "answer | side_question | confirm_slot | decline_slot | confirm_booking | decline_booking | cancel | modify | human | greeting | other",
  "action": "NONE | GET_SLOTS | LIST_SERVICES | COMMIT_BOOKING | RESET",
  "proposed": {
    "branchName": "الفرع الذي اختاره الزبون بنصه أو null",
    "department": "القسم الذي اختاره أو null",
    "serviceName": "الخدمة التي اختارها أو null",
    "doctorName": "الطبيب الذي اختاره أو null",
    "date": "اليوم أو التاريخ الذي ذكره (باجر، عقب باجر، YYYY-MM-DD) أو null",
    "time": "الوقت الذي ذكره (HH:mm أو العصر/الظهر...) أو null",
    "patientName": "اسم الزبون إذا أعطاه أو null"
  }
}

قواعد القرار:
- أي كيان في proposed يجب أن يكون مطابقاً فعلياً لبيانات العيادة الرسمية أعلاه (بالتسامح الإملائي).
- side_question: السؤال لا يخص اختياراً من روتين الحجز → الرد فيه الجواب + العودة لنفس السؤال، action: NONE.
- confirm_slot: وافق على الوقت (موافق/يناسبني/ثبت الوقت/نعم). confirm_booking: تأكيد نهائي بعد عرض الملخص (تمام/أكيد/ثبت). decline_slot/decline_booking: رفض.
- GET_SLOTS: فقط عندما تكون الخدمة محددة ونحتاج مواعيد حقيقية. LIST_SERVICES: عندما يطلب القائمة. COMMIT_BOOKING: فقط عند التأكيد النهائي الكامل. RESET: عندما يريد تصفير المحادثة أو حجز جديد كامل.
- لا ترجع "undefined" أو كلمات وهمية في proposed — فقط null أو قيم حقيقية.
- ⚠️ تحذير صارم: اختيار الفرع أو القسم أو الخدمة ليس تأكيداً نهائياً للحجز. لا تطلبي action: "COMMIT_BOOKING" إطلاقاً إلا بعد الظروف التالية معاً: (1) الخدمة محددة، (2) الطبيب محدد، (3) الوقت محدد، (4) الاسم مسجل، (5) ملخص الحجز عُرض على الزبون، (6) الزبون قال صراحة "نعم ثبت" أو "أكيد" أو "تمام". أي تثبيت مبكر يعتبر خطأ فادح.
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
