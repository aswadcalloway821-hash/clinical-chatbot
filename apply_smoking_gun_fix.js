const fs = require('fs');

const aiServiceContent = `import { ClinicContext } from './booking.service';

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
    specialty_requested?: string;
  };
}

export class AIService {
  /**
   * 🧠 محرك فهم اللغة الصافي المعتمد حصراً على gemini-3.1-flash-lite (Status 200)
   */
  async processPureNLU(
    clinicContext: ClinicContext,
    chatHistory: ChatMessage[],
    userMessage: string
  ): Promise<AIStructuredResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    const cleanText = (userMessage || '').trim();
    const slidingHistory = (chatHistory || []).slice(-6);

    if (!apiKey) {
      return this.fallbackPureNLU(cleanText, clinicContext);
    }

    const modelName = 'gemini-3.1-flash-lite';
    const endpoint = \`https://generativelanguage.googleapis.com/v1beta/models/\${modelName}:generateContent?key=\${apiKey}\`;

    const systemInstruction = 
      \`أنت موظف استقبال بشري دافئ ومحترف في \${clinicContext.clinic_name} في العراق. \` +
      \`قواعد صارمة: \` +
      \`1. اكتب ردودك بلهجة عراقية دافئة وقصيرة جداً (سطر إلى سطرين). \` +
      \`2. يمنع منعاً باتاً تكرار الجمل القديمة أو استخدام الإيموجيات أو علامات التنسيق (*, #, @, $). \` +
      \`3. أرجع الإجابة بتنسيق JSON حصراً يحتوي الحقول التالية: \` +
      \`replyText: نص الرد البشري الخالي من التنسيقات، \` +
      \`intent: يجب أن تكون إحدى القيم التالية حصراً بحروف كبيرة: (CONFIRM_BOOKING, REQUEST_BOOKING, INQUIRE_INFO, GENERAL_CHAT)، \` +
      \`extractedDetails: كائن يحتوي patient_name, preferred_doctor, preferred_serviceإذا تم التعرف عليها. \` +
      \`البيانات المتاحة: الأطباء: \${clinicContext.doctors.map(d => d.name).join(', ')}. الخدمات: \${clinicContext.services.map(s => s.name).join(', ')}.\`;

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
            temperature: 0.1,
            maxOutputTokens: 250,
            responseMimeType: 'application/json',
          }
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn('⚠️ Gemini 3.1 Flash Lite API HTTP Error:', res.status, errText);
        return this.fallbackPureNLU(cleanText, clinicContext);
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      let parsed: any = {};
      try {
        parsed = JSON.parse(rawText);
      } catch (pErr) {
        parsed = { replyText: rawText, intent: 'GENERAL_CHAT' };
      }

      let replyText = (parsed.replyText || '')
        .replace(/[\\u{1F600}-\\u{1F64F}\\u{1F300}-\\u{1F5FF}\\u{1F680}-\\u{1F6FF}\\u{1F1E0}-\\u{1F1FF}\\u{2600}-\\u{26FF}\\u{2700}-\\u{27BF}]/gu, '')
        .replace(/[*#@$*_]/g, '')
        .replace(/\\n+/g, ' ')
        .trim();

      if (!replyText) {
        return this.fallbackPureNLU(cleanText, clinicContext);
      }

      const rawIntentStr = String(parsed.intent || '').toUpperCase();
      let normalizedIntent: AIStructuredResponse['intent'] = 'GENERAL_CHAT';

      if (rawIntentStr.includes('CONFIRM') || rawIntentStr.includes('FIX') || rawIntentStr.includes('BOOKED')) {
        normalizedIntent = 'CONFIRM_BOOKING';
      } else if (rawIntentStr.includes('REQUEST') || rawIntentStr.includes('SLOT') || rawIntentStr.includes('BOOK')) {
        normalizedIntent = 'REQUEST_BOOKING';
      } else if (rawIntentStr.includes('INQUIR') || rawIntentStr.includes('PRICE') || rawIntentStr.includes('LOCATION') || rawIntentStr.includes('INFO')) {
        normalizedIntent = 'INQUIRE_INFO';
      }

      return {
        replyText,
        intent: normalizedIntent,
        extractedDetails: parsed.extractedDetails || {},
      };
    } catch (err: any) {
      console.warn('⚠️ Gemini API Call Error:', err.message);
      return this.fallbackPureNLU(cleanText, clinicContext);
    }
  }

  private fallbackPureNLU(cleanText: string, clinicContext: ClinicContext): AIStructuredResponse {
    const isQuestion = /شلون|اسعار|أسعار|تكلفة|وين|مكان|بكم|سعر/i.test(cleanText);
    const isDental = /اسنان|أسنان|حشوة|تقويم|تنظيف/i.test(cleanText);
    const isBooking = /حجز|موعد|أحجز|احجز|اريد|أريد/i.test(cleanText);
    const isConfirm = /ثبت|تأكيد|تمام|اوكي|أوكي|ماشي|نعم|اي/i.test(cleanText);
    const words = cleanText.split(/\\s+/).filter(Boolean);
    const isName = words.length >= 2 && !isQuestion && !isBooking && !isConfirm;

    const docObj = isDental 
      ? clinicContext.doctors.find(d => (d.title || d.name).includes('أسنان') || (d.title || d.name).includes('سمر') || (d.title || d.name).includes('محمد')) || clinicContext.doctors[0]
      : clinicContext.doctors[0];
    const serviceObj = isDental
      ? clinicContext.services.find(s => s.name.includes('أسنان') || s.name.includes('حشوة')) || clinicContext.services[0]
      : clinicContext.services[0];

    if (isConfirm || isName) {
      return {
        replyText: \`تدلل عيني نثبت حجزك عند \${docObj.name} ننتظرك بالعيادة\`,
        intent: 'CONFIRM_BOOKING',
        extractedDetails: { patient_name: isName ? cleanText : undefined },
      };
    }

    if (isBooking) {
      return {
        replyText: \`اهلاً بك عيني متوفر حجز لـ \${serviceObj.name} مع \${docObj.name} دزلي اسمك الثنائي حتى نثبته لك\`,
        intent: 'REQUEST_BOOKING',
        extractedDetails: { preferred_doctor: docObj.name, preferred_service: serviceObj.name },
      };
    }

    if (isQuestion) {
      return {
        replyText: \`اهلاً بك عيني عيادتنا بالفرع الرئيسي وسعر \${serviceObj.name} مناسب جدا حاب تثبت موعد دزلي اسمك\`,
        intent: 'INQUIRE_INFO',
      };
    }

    return {
      replyText: \`اهلاً بك عيني نورت عيادتنا حاب تثبت موعد كشفية دزلي اسمك الثنائي\`,
      intent: 'GENERAL_CHAT',
    };
  }
}

export const aiService = new AIService();
`;

fs.writeFileSync('src/services/ai.service.ts', aiServiceContent, 'utf8');
console.log('Successfully updated src/services/ai.service.ts with gemini-3.1-flash-lite!');
