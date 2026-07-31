import { GoogleGenerativeAI } from '@google/generative-ai';
import { NLUResult, TenantConfig } from '../types/booking.js';
import { SlicedContextPayload } from '../fsm/context-slicer.js';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

export class GeminiService {
  /**
   * Parse user intent and extract entities structured via JSON
   */
  public static async parseNluIntent(
    userMessage: string,
    currentState: string,
    tenant: TenantConfig
  ): Promise<NLUResult> {
    const prompt = `
أنت نظام استخراج النوايا والبيانات لدعم نظام حجز طبي.
تحليل رسالة المريض التالية واستخراج النية (intent) والكيانات (entities).

حالة الحوار الحالية: ${currentState}

فروع العيادة المتوفرة: ${JSON.stringify(tenant.branches.map(b => b.name))}
الخدمات المتوفرة: ${JSON.stringify(tenant.services.map(s => s.name))}
الأطباء المتوفرون: ${JSON.stringify(tenant.doctors.map(d => d.name))}

رسالة المريض: "${userMessage}"

قواعد مهمة:
- إذا طلب موظف بشري أو شكوى أو تعبير عن الغضب شديد -> intent: "REQUEST_HUMAN" أو "ANGRY_EXPRESSION"
- إذا يسأل عن سعر أو موقع أو معلومة -> intent: "ASK_FAQ"
- إذا اختار فرعاً أو طبيباً أو خدمة -> اختر النية والكيان المناسب.
- إذا أعطى اسمه ثلاثياً -> intent: "PROVIDE_NAME" والكيان patientName
- إذا وافق أو أكد (نعم، اوكي، تم، اكيد، تأكيد) -> intent: "CONFIRM"
- إذا رفض أو الغى (لا، الغاء، تراجع) -> intent: "CANCEL"

أرجع نتيجة JSON فقط بالتنسيق التالي بدون أي نص إضافي:
{
  "intent": "GREETING | SELECT_BRANCH | SELECT_SERVICE | SELECT_DOCTOR | SELECT_SLOT | PROVIDE_NAME | CONFIRM | CANCEL | ASK_FAQ | REQUEST_HUMAN | ANGRY_EXPRESSION | UNKNOWN",
  "entities": {
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
      const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
      const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: 'application/json' } });
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
   * Generate Authentic Iraqi Dialect response ("سارة الرقمية")
   */
  public static async generateIraqiResponse(slicedContext: SlicedContextPayload): Promise<string> {
    const prompt = `
${slicedContext.personaGuidance}

المركز الطبي: ${slicedContext.clinicName}
الخطوة الحالية: ${slicedContext.step}
التعليمات المطلوبة منكِ الآن: ${slicedContext.stepInstruction}
بيانات الخطوة الحالية: ${JSON.stringify(slicedContext.stepData)}
رسالة المريض الأخيرة: "${slicedContext.userMessage}"

صوغي ردكِ بالكامل بلهجة عراقية محبوبة وعفوية، بدون أي نجوم أو خطوط أو رموز تنصيص أو Markdown.
أجيبي المريض مباشرة واسأليه عن الخطوة التالية بأسلوب سلس ودافئ.
`;

    try {
      const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
      const model = genAI.getGenerativeModel({ model: modelName });
      const response = await model.generateContent(prompt);

      let reply = response.response.text()?.trim() || '';
      
      // Clean any accidental Markdown formatting to ensure 100% human-like response
      reply = reply
        .replace(/\*/g, '')
        .replace(/#/g, '')
        .replace(/`/g, '')
        .replace(/_/g, '')
        .trim();

      return reply;
    } catch (error) {
      console.error('Gemini NLG Error:', error);
      return 'يا أهلاً بيك أستاذي العزيز، نورتنا بمركزنا. شلون أقدر أساعدك اليوم؟';
    }
  }

  /**
   * Answer FAQ for Freeze & Resume protocol
   */
  public static async answerFaq(userMessage: string, tenant: TenantConfig): Promise<string> {
    const prompt = `
أنتِ "سارة الرقمية"، موظفة استقبال مركز "${tenant.clinicName}".
سأل المريض السؤال التالي أثناء الحجز: "${userMessage}"

الأسئلة الشائعة والمعلومات المتوفرة:
${JSON.stringify(tenant.faqs)}
الخدمات والأسعار: ${JSON.stringify(tenant.services)}
الفروع والمواقع: ${JSON.stringify(tenant.branches)}

أجيبي عن سؤال المريض بلهجة عراقية عفوية جداً ودقيقة وبدون أي تنسيق Markdown.
`;

    try {
      const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
      const model = genAI.getGenerativeModel({ model: modelName });
      const response = await model.generateContent(prompt);

      return (response.response.text() || '')
        .replace(/\*/g, '')
        .replace(/#/g, '')
        .replace(/`/g, '')
        .trim();
    } catch (error) {
      return 'تدلل عيني، أستاذي العزيز تكدر تطلع على كافة التفاصيل والموقع من خلال العيادة أو تتصل مباشرة بسكرتاريتنا.';
    }
  }
}
