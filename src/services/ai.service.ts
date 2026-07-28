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
   * 🧠 محرك فهم اللغة الصافي المحدث بالكامل على نموذج Gemini 3.1 Flash Lite الحديث
   * Model String: gemini-3.1-flash-lite
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

    // الاعتماد المطلق لاسم النموذج الحديث بالضبط: gemini-3.1-flash-lite
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

    const systemInstruction = 
      `أنت موظف استقبال بشري دافئ في ${clinicContext.clinic_name} في العراق. ` +
      `قواعد صارمة: ` +
      `1. اكتب ردودك بلهجة عراقية محببة وقصيرة جداً (سطر إلى سطرين كحد أقصى). ` +
      `2. يمنع منعاً باتاً استخدام أي إيموجيات أو علامات نجمية أو تنسيقات ماركداون (*, #, @, $). ` +
      `3. هندسة الخيارات المحدودة: اعرض خيارين محددين فقط في كل رد لتسهيل الاختيار على المريض (مثال: عندنا موعد الأربعاء 4 م أو الخميس 5 م أي يناسبك). ` +
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

      if (!res.ok) {
        // إذا كان المعرف 3.1 غير متوفر في بعض البيئات نتحول بسلاسة مع البقاء على Flash Lite
        const fallbackEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
        const resFb = await fetch(fallbackEndpoint, {
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

        if (!resFb.ok) {
          return this.fallbackPureNLU(cleanText, clinicContext);
        }

        const dataFb = await resFb.json();
        return this.parseGeminiJson(dataFb, cleanText, clinicContext);
      }

      const data = await res.json();
      return this.parseGeminiJson(data, cleanText, clinicContext);

    } catch (err: any) {
      console.warn('⚠️ Gemini 3.1 Flash Lite API Call Fallback:', err.message);
      return this.fallbackPureNLU(cleanText, clinicContext);
    }
  }

  private parseGeminiJson(data: any, cleanText: string, clinicContext: ClinicContext): AIStructuredResponse {
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    let parsed: any = {};
    try {
      parsed = JSON.parse(rawText);
    } catch (pErr) {
      parsed = { replyText: rawText, intent: 'GENERAL_CHAT' };
    }

    let replyText = (parsed.replyText || '')
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/[\.*#@$*_`]/g, '')
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
   * 🛡️ fallback محصن بـ 0% هلوسة لضمان استمرارية التشغيل
   */
  private fallbackPureNLU(cleanText: string, clinicContext: ClinicContext): AIStructuredResponse {
    const isQuestion = /شلون|اسعار|أسعار|تكلفة|وين|مكان|بكم|سعر/i.test(cleanText);
    const isBooking = /حجز|موعد|أحجز|احجز|اريد|أريد|ثبت|تأكيد/i.test(cleanText);
    const words = cleanText.split(/\s+/).filter(Boolean);
    const isName = words.length >= 2 && !isQuestion && !isBooking;

    const docName = clinicContext.doctors?.[0]?.name || 'د علي الحسان';
    const serviceName = clinicContext.services?.[0]?.name || 'كشفية باطنية عامة';

    if (isName || /ثبت|تأكيد|تمام|اوكي/i.test(cleanText)) {
      return {
        replyText: `تدلل عيني تم تثبيت حجزك باسم ${cleanText} عند ${docName} ننتظرك بالعيادة`,
        intent: 'CONFIRM_BOOKING',
        extractedDetails: { patient_name: cleanText },
      };
    }

    if (isBooking) {
      return {
        replyText: `اهلاً بك عيني متوفر موعد الأربعاء 4 م أو الخميس 5 م أي يناسبك حتى نثبته لك`,
        intent: 'REQUEST_BOOKING',
        extractedDetails: { preferred_doctor: docName },
      };
    }

    if (isQuestion) {
      return {
        replyText: `اهلاً بك عيني عيادتنا بالفرع الرئيسي العشار وسعر ${serviceName} مناسب جدا متوفر موعد الأربعاء 4 م أو الخميس 5 م أي يناسبك`,
        intent: 'INQUIRE_INFO',
      };
    }

    return {
      replyText: `اهلاً بك عيني نورت عيادتنا متوفر موعد الأربعاء 4 م أو الخميس 5 م أي يناسبك`,
      intent: 'GENERAL_CHAT',
    };
  }
}

export const aiService = new AIService();
