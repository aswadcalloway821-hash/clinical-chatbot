import { ClinicContext, AvailableSlot } from './booking.service';

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

    const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-flash-latest'];
    let rawText = '';
    let apiSuccess = false;

    if (apiKey) {
      for (const modelName of modelsToTry) {
        try {
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
            "3. ضوابط النوايا والأسماء الصارمة جداً: " +
            "   - يمنع منعاً باتاً تصنيف الرسالة كـ CONFIRM_BOOKING إلا إذا كانت موافقة صريحة جداً أو اسماً شخصياً حقيقياً صريحاً (مثل: حسين علي المحمداوي, محمد جاسم). " +
            "   - أي كلام عام أو استغراب أو سؤال (مثل: شنو سالفتك انت, منو انت, وين مكانكم, شنو السالفة, شكو), يجب أن يكون تصنيفه GENERAL_CHAT أو INQUIRE_INFO مع إرجاع extractedDetails فارغاً {}! " +
            "4. أرجع JSON يحتوي: replyText, intent (CONFIRM_BOOKING, REQUEST_BOOKING, INQUIRE_INFO, GENERAL_CHAT), extractedDetails. " +
            "بيانات العيادة المتاحة الحقيقية: " +
            "الأطباء: " + doctorsStr + ". " +
            "الخدمات: " + servicesStr + ". " +
            "الفروع: " + branchesStr + ". " +
            "المواعيد الشاغرة المتاحة الآن: " + slotsPromptText + ".";

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
                temperature: 0.1,
                maxOutputTokens: 300,
                responseMimeType: 'application/json',
              }
            }),
          });

          if (res.ok) {
            const data = await res.json();
            rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (rawText) {
              apiSuccess = true;
              break;
            }
          }
        } catch (e) {}
      }
    }

    if (!apiSuccess || !rawText) {
      return this.generateDynamicPureResponse(cleanText, clinicContext, nearestSlots);
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

    const extractedName = parsed.extractedDetails?.patient_name || '';
    const isNonNamePhrase = /سالفتك|سالفة|شنو|منو|انت|أنت|مكانكم|وين|شكو|اخي|أخي|عيني|سلام|هلو|أهلاً|اهلاً|شكرا|شكراً/i.test(extractedName) || /سالفتك|سالفة|منو انت|وين مكانكم|شنو السالفة|شكو/i.test(cleanText);

    let normalizedIntent: AIStructuredResponse['intent'] = 'GENERAL_CHAT';
    const rawIntentStr = String(parsed.intent || '').toUpperCase();

    if (!isNonNamePhrase && (rawIntentStr.includes('CONFIRM') || rawIntentStr.includes('FIX') || rawIntentStr.includes('BOOKED'))) {
      normalizedIntent = 'CONFIRM_BOOKING';
    } else if (rawIntentStr.includes('REQUEST') || rawIntentStr.includes('SLOT') || rawIntentStr.includes('BOOK')) {
      normalizedIntent = 'REQUEST_BOOKING';
    } else if (rawIntentStr.includes('INQUIR') || rawIntentStr.includes('PRICE') || rawIntentStr.includes('LOCATION') || rawIntentStr.includes('INFO') || /وين|مكان/i.test(cleanText)) {
      normalizedIntent = 'INQUIRE_INFO';
    }

    if (isNonNamePhrase && parsed.extractedDetails) {
      delete parsed.extractedDetails.patient_name;
    }

    return {
      replyText: replyText || 'اهلاً بك عيني في العيادة كيف يمكنني مساعدتك اليوم؟',
      intent: normalizedIntent,
      extractedDetails: parsed.extractedDetails || {},
    };
  }

  private generateDynamicPureResponse(
    cleanText: string,
    clinicContext: ClinicContext,
    nearestSlots?: AvailableSlot[]
  ): AIStructuredResponse {
    const isQuestion = /شلون|اسعار|أسعار|تكلفة|وين|مكان|بكم|سعر|خدمات|المتوفرة/i.test(cleanText);
    const isDental = /اسنان|أسنان|حشوة|تقويم|تنظيف/i.test(cleanText);
    const isBooking = /حجز|موعد|أحجز|احجز|اريد|أريد/i.test(cleanText);
    const isConfirm = /ثبت|تأكيد|تمام|اوكي|أوكي|ماشي|نعم|اي/i.test(cleanText);
    const isNonNamePhrase = /سالفتك|سالفة|شنو|منو|انت|أنت|مكانكم|وين|شكو/i.test(cleanText);
    const words = cleanText.split(/\s+/).filter(Boolean);
    const isName = words.length >= 2 && !isQuestion && !isBooking && !isConfirm && !isNonNamePhrase;

    const docObj = isDental 
      ? clinicContext.doctors.find(d => (d.title || d.name).includes('أسنان') || (d.title || d.name).includes('سمر') || (d.title || d.name).includes('محمد')) || clinicContext.doctors[0]
      : clinicContext.doctors[0];
    const serviceObj = isDental
      ? clinicContext.services.find(s => s.name.includes('أسنان') || s.name.includes('حشوة')) || clinicContext.services[0]
      : clinicContext.services[0];

    let slotsText = '';
    if (nearestSlots && nearestSlots.length > 0) {
      const d1 = new Date(nearestSlots[0].slot_time);
      const day1Str = d1.toLocaleDateString('ar-IQ', { weekday: 'long' });
      const time1Str = d1.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
      slotsText = day1Str + " الساعة " + time1Str;
    }

    if ((isConfirm || isName) && !isNonNamePhrase) {
      return {
        replyText: "تدلل عيني نثبت حجزك عند " + docObj.name + " ننتظرك بالعيادة",
        intent: 'CONFIRM_BOOKING',
        extractedDetails: { patient_name: isName ? cleanText : undefined },
      };
    }

    if (isBooking) {
      return {
        replyText: "اهلاً بك عيني أقرب موعد متاح لـ " + serviceObj.name + " مع " + docObj.name + " هو " + slotsText + " حاب تثبت الموعد دزلي اسمك الثنائي",
        intent: 'REQUEST_BOOKING',
        extractedDetails: { preferred_doctor: docObj.name, preferred_service: serviceObj.name },
      };
    }

    if (isQuestion) {
      return {
        replyText: "اهلاً بك عيني عيادتنا بالفرع الرئيسي وتتوفر كشفيات " + clinicContext.services.map(s => s.name).join(' و ') + " حاب تثبت موعد دزلي اسمك الثنائي",
        intent: 'INQUIRE_INFO',
      };
    }

    return {
      replyText: "اهلاً بك عيني في " + clinicContext.clinic_name + " نورتنا كيف يمكننا مساعدتك اليوم؟",
      intent: 'GENERAL_CHAT',
    };
  }
}

export const aiService = new AIService();
