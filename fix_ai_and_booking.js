const fs = require('fs');

if (fs.existsSync('src/routes/api.routes.ts')) {
  fs.unlinkSync('src/routes/api.routes.ts');
  console.log('✅ Deleted unused src/routes/api.routes.ts file');
}

const aiCode = `import { ClinicContext, AvailableSlot } from './booking.service';

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
  async processPureNLU(
    clinicContext: ClinicContext,
    chatHistory: ChatMessage[],
    userMessage: string,
    nearestSlots?: AvailableSlot[]
  ): Promise<AIStructuredResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    const cleanText = (userMessage || '').trim();

    const cleanHistory = (chatHistory || []).filter(m => {
      const txt = m.parts?.[0]?.text || '';
      return !txt.includes('انحجز قبل لحظات') && !txt.includes('الأربعاء 4 م');
    });
    const slidingHistory = cleanHistory.slice(-6);

    const modelName = 'gemini-3.1-flash-lite';
    const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + apiKey;

    let slotsPromptText = 'لا توجد مواعيد محددة مسبقاً.';
    if (nearestSlots && nearestSlots.length > 0) {
      slotsPromptText = nearestSlots.map(s => {
        const d = new Date(s.slot_time);
        const dayStr = d.toLocaleDateString('ar-IQ', { weekday: 'long', month: 'numeric', day: 'numeric' });
        const timeStr = d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
        return "موعد متاح غير محجوز: " + dayStr + " الساعة " + timeStr + " عند " + s.doctor_name + " لخدمة " + s.service_name;
      }).join(' | ');
    }

    const doctorsStr = clinicContext.doctors.map(d => d.name + ' (' + (d.title || 'أخصائي') + ')').join(', ');
    const servicesStr = clinicContext.services.map(s => s.name).join(', ');
    const branchesStr = clinicContext.branches.map(b => b.name).join(', ');

    const systemInstruction = 
      "أنت موظف استقبال بشري دافئ ومحترف جداً يراسل المريض مباشرة على الواتساب في " + clinicContext.clinic_name + " في العراق. " +
      "قواعد صارمة 100%: " +
      "1. اكتب جميع ردودك بلهجة عراقية دافئة، محببة، وقصيرة جداً (سطر إلى سطرين كحد أقصى). " +
      "2. يمنع منعاً باتاً استخدام أي إيموجيات أو علامات نجمية أو أي رموز ماركداون (*, #, @, $, _). " +
      "3. أنت تصيغ الرد البشري بالكامل بحرية ومرونة تامة بناءً على بيانات العيادة والمواعيد المتاحة المرفقة أدناه. " +
      "4. اعرض المواعيد الشاغرة المتاحة المرفقة لتسهيل الاختيار على المريض. " +
      "5. يجب إرجاع الإجابة بتنسيق JSON حصراً يحتوي الحقول التالية: " +
      "replyText: النص البشري الصافي الذي سيصل للمريض مباشرة على الواتساب، " +
      "intent: إحدى القيم التالية بحروف كبيرة: (CONFIRM_BOOKING, REQUEST_BOOKING, INQUIRE_INFO, GENERAL_CHAT)، " +
      "extractedDetails: كائن يحتوي patient_name (إذا ذكر المريض اسمه أو أكده)، preferred_doctor, preferred_service. " +
      "بيانات العيادة المتاحة الحقيقية من الداتا بيز: " +
      "الأطباء: " + doctorsStr + ". " +
      "الخدمات: " + servicesStr + ". " +
      "الفروع: " + branchesStr + ". " +
      "المواعيد الشاغرة الحقيقية المتاحة من الداتا بيز الآن: " + slotsPromptText + ".";

    const contentsPayload = [
      ...slidingHistory,
      {
        role: 'user',
        parts: [{ text: userMessage }]
      }
    ];

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contentsPayload,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 300,
          responseMimeType: 'application/json',
        }
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error("Gemini API Error " + res.status + ": " + errText);
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
      replyText: replyText || 'اهلاً بك عيني في العيادة كيف يمكنني مساعدتك اليوم؟',
      intent: normalizedIntent,
      extractedDetails: parsed.extractedDetails || {},
    };
  }
}

export const aiService = new AIService();
`;

fs.writeFileSync('src/services/ai.service.ts', aiCode, 'utf8');
console.log('✅ Updated src/services/ai.service.ts');
