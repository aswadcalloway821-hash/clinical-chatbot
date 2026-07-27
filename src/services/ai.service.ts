import { ClinicContext } from './booking.service';

export interface ChatMessage {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export interface AIStructuredResponse {
  replyText: string;
  intent: 'CONFIRM_BOOKING' | 'REQUEST_BOOKING' | 'INQUIRE_INFO' | 'GENERAL_CHAT';
  extractedDetails?: {
    patient_name?: string;
    preferred_doctor?: string;
    preferred_service?: string;
    preferred_branch?: string;
  };
}

export class AIService {
  /**
   * 🧠 محرك فهم اللغة الصافي (Pure Gemini Flash NLU)
   * يدعم جيل موديلات Gemini 2.0 / 1.5 Flash الحديثة مع المزامنة والسقوط الآمن للنموذج الأسرع
   */
  async processPureNLU(
    clinicContext: ClinicContext,
    chatHistory: ChatMessage[],
    userMessage: string
  ): Promise<AIStructuredResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    const cleanText = (userMessage || '').trim();

    // اقتصار الذاكرة التراكمية على آخر 8 رسائل فقط (4 أزواج محادثة)
    const slidingHistory = chatHistory.slice(-8);

    if (!apiKey) {
      return this.fallbackPureNLU(cleanText, clinicContext);
    }

    // تسلسل الموديلات الحديثة المقترحة مع السقوط المرن التلقائي
    const requestedModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite-preview-02-05';
    const candidateModels = [requestedModel, 'gemini-2.0-flash', 'gemini-1.5-flash'];

    const systemInstruction = 
      `أنت موظف استقبال بشري دافئ في ${clinicContext.clinic_name} في العراق. ` +
      `قواعد صارمة: ` +
      `1. اكتب ردودك بلهجة عراقية محببة وقصيرة جداً (سطر إلى سطرين كحد أقصى). ` +
      `2. يمنع منعاً باتاً استخدام أي إيموجيات أو علامات نجمية أو تنسيقات ماركداون (*, #, @, $). ` +
      `3. اعرض خيارين محددين فقط للمواعيد المتاحة لتسهيل الاختيار على المريض. ` +
      `4. التسلسل الإجباري للخدمة: الفرع ➔ الخدمة ➔ أقرب موعدين ➔ اسم المريض والتأكيد. ` +
      `5. أرجع الإجابة بتنسيق JSON حصراً يحتوي الحقول التالية: ` +
      `replyText (نص الرد البشري العراقي الخالي من التنسيقات والإيموجيات)، ` +
      `intent (إحدى القيم التالية: CONFIRM_BOOKING, REQUEST_BOOKING, INQUIRE_INFO, GENERAL_CHAT)، ` +
      `extractedDetails (كائن يحتوي patient_name, preferred_doctor, preferred_service, preferred_branch إذا تم التعرف عليها). ` +
      `بيانات العيادة المتاحة: الأطباء: ${clinicContext.doctors.map(d => d.name).join(', ')}، الخدمات: ${clinicContext.services.map(s => s.name).join(', ')}، الفروع: ${clinicContext.branches.map(b => b.name).join(', ')}.`;

    const contentsPayload = [
      ...slidingHistory,
      {
        role: 'user',
        parts: [{ text: userMessage }]
      }
    ];

    let rawText = '';
    let success = false;

    // تجربة الموديل الحديث أولاً مع السقوط التلقائي السريع عند عدم توفر اسم الموديل المحدد
    for (const modelName of candidateModels) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: contentsPayload,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 250,
              responseMimeType: 'application/json',
            }
          }),
        });

        if (res.ok) {
          const data = await res.json();
          rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (rawText) {
            success = true;
            break;
          }
        }
      } catch (e) {
        // تجربة الموديل التالي مباشرة
      }
    }

    if (!success || !rawText) {
      return this.fallbackPureNLU(cleanText, clinicContext);
    }

    let parsed: any = {};
    try {
      parsed = JSON.parse(rawText);
    } catch (pErr) {
      parsed = { replyText: rawText, intent: 'GENERAL_CHAT' };
    }

    let replyText = (parsed.replyText || '')
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/[*#@$*_]/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    if (!replyText) {
      return this.fallbackPureNLU(cleanText, clinicContext);
    }

    const validIntents = ['CONFIRM_BOOKING', 'REQUEST_BOOKING', 'INQUIRE_INFO', 'GENERAL_CHAT'];
    const intent = validIntents.includes(parsed.intent) ? parsed.intent : 'GENERAL_CHAT';

    return {
      replyText,
      intent,
      extractedDetails: parsed.extractedDetails || {},
    };
  }

  /**
   * 🛡️ fallback محصن ديناميكي دون استخدام مواعيد ثابتة
   */
  private fallbackPureNLU(cleanText: string, clinicContext: ClinicContext): AIStructuredResponse {
    const isQuestion = /شلون|اسعار|أسعار|تكلفة|وين|مكان|بكم|سعر/i.test(cleanText);
    const isBooking = /حجز|موعد|أحجز|احجز|اريد|أريد/i.test(cleanText);
    const isConfirm = /ثبت|تأكيد|تمام|اوكي|أوكي|ماشي|نعم|اي/i.test(cleanText);
    const words = cleanText.split(/\s+/).filter(Boolean);
    const isName = words.length >= 2 && !isQuestion && !isBooking && !isConfirm;

    const docName = clinicContext.doctors?.[0]?.name || 'د علي الحسان';
    const serviceName = clinicContext.services?.[0]?.name || 'كشفية باطنية عامة';

    if (isConfirm || isName) {
      return {
        replyText: `تدلل عيني نثبت حجزك عند ${docName} ننتظرك بالعيادة`,
        intent: 'CONFIRM_BOOKING',
        extractedDetails: { patient_name: isName ? cleanText : undefined },
      };
    }

    if (isBooking) {
      return {
        replyText: `اهلاً بك عيني متوفر حجز لـ ${serviceName} مع ${docName} دزلي اسمك الثنائي حتى نثبته لك`,
        intent: 'REQUEST_BOOKING',
        extractedDetails: { preferred_doctor: docName },
      };
    }

    if (isQuestion) {
      return {
        replyText: `اهلاً بك عيني عيادتنا بالفرع الرئيسي وسعر ${serviceName} مناسب جدا حاب تثبت موعد دزلي اسمك`,
        intent: 'INQUIRE_INFO',
      };
    }

    return {
      replyText: `اهلاً بك عيني نورت عيادتنا حاب تثبت موعد كشفية دزلي اسمك الثنائي`,
      intent: 'GENERAL_CHAT',
    };
  }
}

export const aiService = new AIService();
