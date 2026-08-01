import { GoogleGenerativeAI } from '@google/generative-ai';
import { NLUResult, TenantConfig } from '../types/booking.js';
import { SlicedContextPayload } from '../fsm/context-slicer.js';
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
   * Generate Authentic Iraqi Dialect response ("سارة الرقمية") using real TenantConfig (Zero Dummy Data!)
   */
  public static async generateIraqiResponse(slicedContext: SlicedContextPayload, tenant: TenantConfig): Promise<string> {
    const prompt = `
المركز الطبي الحقيقي: ${slicedContext.clinicName}
الخطوة الحالية: ${slicedContext.step}
التعليمات المطلوبة منكِ الآن: ${slicedContext.stepInstruction}
بيانات الخطوة الحالية: ${JSON.stringify(slicedContext.stepData)}
رسالة المريض الأخيرة: "${slicedContext.userMessage}"

صوغي ردكِ بالكامل بلهجة عراقية محبوبة وعفوية لـ "${slicedContext.clinicName}"، بدون أي نجوم أو خطوط أو رموز تنصيص أو Markdown.
أجيبي المريض مباشرة بحسب التعليمات بدون إضافة أي عبارة ترحيبية أو ختامية مكررة في نهاية الرد!
`;

    try {
      const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.getSystemInstruction(tenant)
      });
      const response = await model.generateContent(prompt);

      const reply = response.response.text()?.trim() || '';
      return this.cleanMarkdown(reply);
    } catch (error) {
      console.error('Gemini NLG Error:', error);
      return `تفضل عيني، أنا بانتظار اختيارك لتكملة الحجز.`;
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
}
