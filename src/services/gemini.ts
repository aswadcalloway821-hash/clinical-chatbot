import { GoogleGenerativeAI } from '@google/generative-ai';
import { NLUResult, TenantConfig } from '../types/booking.js';
import { SlicedContextPayload } from '../fsm/context-slicer.js';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

export class GeminiService {
  /**
   * Build Strict System Instruction for Gemini to 100% prevent any wrong clinic names or hallucinations
   */
  private static getSystemInstruction(tenant: TenantConfig): string {
    const branchNames = tenant.branches.map(b => b.name).join(' ، ');
    const doctorNames = tenant.doctors.map(d => d.name).join(' ، ');

    return `
أنتِ "سارة الرقمية"، موظفة استقبال بشرية في "${tenant.clinicName}".

قواعد أمان عليا وحازمة جداً (STRICT SYSTEM RULES):
1. اسم العيادة والمركز الوحيد والحقيقي هو حصراً "${tenant.clinicName}".
2. يُمنع منعاً باتاً وقطيعاً تلفظ أو كتابة أي اسم آخر مثل "مركز الحياة" أو "مركز الحياة الطبي" إطلاقاً وتحت أي ظرف!
3. الفروع المتاحة حصراً بالعيادة هي: ${branchNames}. يُمنع منعاً باتاً ذكر فروع أخرى مثل (المنصور، الكرادة، بغداد) لأن العيادة بالبصرة فقط!
4. الأطباء المتاحون حصراً هم: ${doctorNames}.
5. التحدث بلغة عراقية بغدادية عفوية ومباشرة بدون رموز أو نجوم أو تنسيقات Markdown (*, **, #).
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
   * Generate Authentic Iraqi Dialect response ("سارة الرقمية")
   */
  public static async generateIraqiResponse(slicedContext: SlicedContextPayload): Promise<string> {
    const prompt = `
المركز الطبي الحقيقي: ${slicedContext.clinicName}
الخطوة الحالية: ${slicedContext.step}
التعليمات المطلوبة منكِ الآن: ${slicedContext.stepInstruction}
بيانات الخطوة الحالية: ${JSON.stringify(slicedContext.stepData)}
رسالة المريض الأخيرة: "${slicedContext.userMessage}"

صوغي ردكِ بالكامل بلهجة عراقية محبوبة وعفوية لـ "${slicedContext.clinicName}"، بدون أي نجوم أو خطوط أو رموز تنصيص أو Markdown.
أجيبي المريض مباشرة واسأليه عن الخطوة التالية بأسلوب سلس ودافئ.
`;

    try {
      const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
      const dummyTenant: TenantConfig = {
        tenantId: 't1',
        clinicName: slicedContext.clinicName,
        secretaryPhone: '07881015584',
        branches: [{ id: 'b1', name: 'فرع الجزائر', address: 'البصرة', phone: '' }, { id: 'b2', name: 'فرع العشار', address: 'البصرة', phone: '' }],
        services: [],
        doctors: [{ id: 'd1', branchId: 'b1', name: 'د. أحمد', specialty: '', services: [], calendarId: '', workingHours: { days: [], startHour: 9, endHour: 17, slotDurationMinutes: 30 } }],
        faqs: []
      };

      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.getSystemInstruction(dummyTenant)
      });
      const response = await model.generateContent(prompt);

      let reply = response.response.text()?.trim() || '';
      
      // Clean any accidental Markdown formatting
      reply = reply
        .replace(/\*/g, '')
        .replace(/#/g, '')
        .replace(/`/g, '')
        .replace(/_/g, '')
        .trim();

      return reply;
    } catch (error) {
      console.error('Gemini NLG Error:', error);
      return `أهلاً بك في ${slicedContext.clinicName}. كيف أقدر أساعدك اليوم؟`;
    }
  }

  /**
   * Answer FAQ for Freeze & Resume protocol
   */
  public static async answerFaq(userMessage: string, tenant: TenantConfig): Promise<string> {
    const prompt = `
سأل المريض السؤال التالي: "${userMessage}"

المعلومات الرسمية المتاحة لـ "${tenant.clinicName}":
الأسئلة الشائعة: ${JSON.stringify(tenant.faqs)}
الخدمات والأسعار: ${JSON.stringify(tenant.services)}
الفروع والمواقع الحقيقية بالبصرة: ${JSON.stringify(tenant.branches)}

أجيبي عن سؤال المريض بلهجة عراقية عفوية جداً وبدون أي تنميق أو تنسيق Markdown.
`;

    try {
      const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.getSystemInstruction(tenant)
      });
      const response = await model.generateContent(prompt);

      return (response.response.text() || '')
        .replace(/\*/g, '')
        .replace(/#/g, '')
        .replace(/`/g, '')
        .trim();
    } catch (error) {
      return `أهلاً بك بـ ${tenant.clinicName}، يمكنك الاطلاع على التفاصيل والموقع من العيادة أو الاتصال بالسكرتارية: ${tenant.secretaryPhone}.`;
    }
  }
}
