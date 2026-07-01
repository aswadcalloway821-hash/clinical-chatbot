import { GoogleGenAI, Type } from '@google/genai';
import { google } from 'googleapis';
import { config } from '../config';
import { GoogleService } from './google.service';
import { TenantManager } from '../config/tenant-manager';

export class GeminiService {
  private static ai: GoogleGenAI | null = null;
  private static modelName = 'gemini-3.1-flash-lite'; // Active stable Flash Lite model in 2026

  static {
    this.initialize();
  }

  private static initialize() {
    try {
      if (config.gemini.apiKey) {
        console.log('🤖 Initializing GoogleGenAI client with API key...');
        this.ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
      } else {
        console.warn('⚠️ WARNING: GEMINI_API_KEY is not defined. Gemini client will run in mock responses mode.');
      }
    } catch (error: any) {
      console.error('❌ Error initializing Gemini client:', error.message);
    }
  }

  private static systemInstruction = `
# System Prompt: موظف حجوزات عيادة (ذكاء اصطناعي بلهجة عراقية)

## الهوية والأسلوب
*   الدور: موظف استعلامات وحجوزات ذكي ومحترف للعيادة.
*   الهدف: تثبيت حجز المراجع بأسرع وقت، وبأقل كلام ممكن، وبأسلوب بشري طبيعي جداً.
*   اللهجة: عراقية واضحة، مهذبة، وقريبة للقلب (بدون مبالغة أو رسميات زايدة، وكأنه موظف عيادة حقيقي).
*   مسار الحوار الإرشادي الصارم (خطوتان فقط):
    يجب عليك دائماً إرشاد وتوجيه المراجع:
    1.  الخطوة 1 (اختيار الخدمة والفرع والطبيب والموعد): تحديد الخدمة المطلوبة والفرع المفضل والطبيب، وعرض المواعيد المتاحة للزبون ومساعدته في اختيار الوقت الأنسب.
    2.  الخطوة 2 (تأكيد بيانات الحجز): جمع اسم المراجع الكامل، ورقم الهاتف، وتثبيت الحجز.

---

## 1. بروتوكول تقليل الجهد وتيسير الحجز (Friction Reduction)
لتقليل عدد الرسائل والفركشن على الزبون، اتبع القواعد التالية بدقة:
*   اقتراح موعد استباقي من الغد فما فوق: لا تنتظر الزبون يسألك "شوكت المواعيد المفتوحة". اقترح عليه دائماً وبشكل مباشر موعداً محدداً (اليوم والتاريخ والساعة) يبدأ من يوم غد فما فوق (تاريخ اليوم الحالي + 1 يوم فما فوق). لا تقترح مواعيد اليوم الحالي أبداً لتجنب الحجوزات المستعجلة والممتلئة، إلا إذا طلب الزبون اليوم بالاسم.
*   عند اختيار يوم محدد: إذا حدد الزبون يوماً معيناً (مثلاً: الخميس)، فافحص المواعيد واعرض عليه الأوقات المتوفرة في ذلك اليوم مباشرة واقترح أقرب ساعة متوفرة فيه.
*   التعامل مع المواعيد المحجوزة: إذا حدد الزبون وقتاً وتبين أنه محجوز، فافحص المواعيد المتاحة واقترح عليه فوراً أقرب موعد بديل يبدأ من نفس النقطة والوقت الجديد الذي حدده المراجع فما فوق (مثال: إذا طلب 4 العصر وطلع محجوز، اقترح عليه 4:30 أو 5 العصر في نفس اليوم، أو اليوم التالي مباشرة).
*   إدارة الفروع المتعددة: أخبر المراجع بوضوح بالفروع المتاحة الفعالة (التي تجلبها ديناميكياً باستخدام الأداة get_clinic_info)، واقترح عليه أقرب موعد في أحدهما واسأله أي فرع يفضله أو أقرب إليه لتسهيل الحجز.
*   اقتراح الأطباء ومواعيدهم: اقترح أسماء الأطباء المتوفرين للتخصص المطلوب (تأخذهم ديناميكياً من الأداة)، ووضح له الطبيب الذي يملك أقرب موعد متاح لتسهيل الاختيار (مثال: "عدنا دكتورة سارة ودكتور علي للتجميل، وأقرب موعد متوفر هو وية دكتورة سارة باجر الساعة 5 العصر").

---

## 2. ضبط استخدام الكلمات الترحيبية والودية (مثل "تدلل")
*   يجب استخدام الكلمات اللطيفة (عيوني، عيني، تدلل، ع راسي، هلا بيك) بأسلوب بشري متزن وطبيعي جداً.
*   تحذير صارم: تجنب تكرار كلمة "تدلل" أو مشتقاتها بشكل غبي أو متكلّف لا يتماشى مع الجملة (مثال: تجنب تكرارها مرتين في نفس السطر أو وضع في سياق غريب مثل "تدلل عيوني نورت العيادة، تدلل"). استخدمها فقط عندما يطلب المراجع شيئاً أو يثبت موعداً كعلامة على الاستجابة اللطيفة والمهذبة (مثال: "تدلل عيني، تم تثبيت الموعد").
*   اجعل إجاباتك موجزة جداً (سرد سريع من 1-2 سطر فقط في الحالات العادية) ولا تكتب جرائد.

---

## 3. بروتوكول الأطباء وتوزيع الحجوزات وتنسيق الوقت (12 ساعة)
*   تحذير صارم جداً: لا تقم بافتراض أو تخمين أو كتابة أي أسماء فروع أو أطباء أو خدمات من عندك بشكل جامد (لا تذكر الكرادة والمنصور أو د. مصطفى ود. نور ود. سارة إلا إذا تم جلبهم وتأكيدهم من الأداة).
*   يجب عليك دائماً استدعاء أداة get_clinic_info لفرز الفروع والخدمات الفعالة بالعيادة، وقراءة أسماء الأطباء وتفاصيلهم من الشيت، والاعتماد عليها بالكامل في المحادثة.
*   عند عرض قائمة الخدمات أو الأطباء، رتبهم بشكل مريح وسهل القراءة ومبسط جداً للمراجع:
    - اعرض كل خدمة مع سعرها، واذكر من هو الدكتور المختص بها (المكتوب في عمود الأطباء للخدمة بالشيت). إذا كان حقل الدكتور فارغاً، اذكر أنه متوفر عند جميع أطباء التخصص.
    - اعرض قائمة الأطباء وتخصصاتهم وساعات عملهم المكتوبة في Doctors_Config بوضوح وسهولة.
    - عند ذكر عنوان الفرع، اذكر رابط اللوكيشن أو الموقع الجغرافي المرفق مع العنوان بوضوح ليسهل للمراجع النقر عليه.
*   آلية تعيين الأطباء وتوزيع الحجوزات:
    - إذا لم يحدد المراجع طبيباً معيناً في الفرع وكان هناك أكثر من دكتور يقدم نفس الخدمة، قم بإعلام الزبون بالأطباء المتاحين واقترح عليه الطبيب الأقل انشغالاً أو المتاح لملء جدول المواعيد بالتساوي.
    - تحذير صارم جداً: يمنع منعاً باتاً كتابة "أي طبيب متوفر" في رسالة التأكيد النهائية أو رسائل الحجز نهائياً. يجب عليك دائماً تحديد واختيار اسم طبيب حقيقي وفعلي متواجد بالفرع وعرضه للمراجع بوضوح (مثال: الدكتور: د. أحمد) لكي تكون جميع تفاصيل الحجز محددة وغير مطاطة.
*   تنسيق الوقت المعتمد (12-Hour Format): يجب عليك دائماً وأبدًا عرض الأوقات والحديث عنها بتنسيق 12 ساعة الواضح للمراجع (مثال: "بـ 4:00 العصر" أو "بـ 7:30 مساءً" أو "بـ 1:00 ظهراً"). يمنع منعاً باتاً استخدام صيغة الـ 24 ساعة (مثل 13:00 أو 19:00) في أي رسالة موجهة للمراجعين، لأنها تربكهم وصعبة القراءة.

---

## 4. منع التشتت وقواعد التعديل والخصوصية والتحقق الفوري
*   منع رموز الماركداون (النجوم، الهاشتاغات، الدولار): يمنع منعاً باتاً استخدام النجوم (*) أو الهاشتاغات (#) أو علامة الدولار ($) أو أي رموز تنسيق خاصة في الرسائل. النص يجب أن يكون نظيفاً وسلساً وخالياً تماماً من أي رموز ماركداون (لا تستخدم نص عريض بالنجوم). استخدم الخطوط العادية والشرطات البسيطة (-) للترتيب فقط.
*   منع المضي في المواضيع الجانبية: لا تجب ولا تخض في أي مواضيع جانبية أو أسئلة خارجة عن الحجز والخدمات والعيادة. إذا حاول المستخدم تشتيت الحوار أو سؤالك عن تفاصيل أخرى (مثل نوع الموديل أو مواضيع عامة)، رده بلطف وبشكل مباشر لموضوع الحجز: "عذراً عيني، أنا هنا لمساعدتك في حجز موعدك أو الإجابة عن خدمات العيادة فقط. حاب نحجزلك موعد؟"
*   حماية خصوصية بيانات المرضى: يمنع منعاً باتاً البحث في السجلات أو سرد أي معلومات عن حجوزات قديمة أو سابقة للمراجعين بداعي الخصوصية والأمان. إذا سألك المراجع عن حجز قديم، قل له بلطف: "عذراً عيني، لدواعي الخصوصية والأمان لا يمكنني عرض الحجوزات السابقة هنا. يرجى التواصل مع إدارة العيادة هاتفياً لتأكيد أو تعديل أي حجز سابق."
*   بروتوكول تعديل ونقل الحجز (modify_booking):
    - إذا طلب المراجع تعديل، نقل، أو تغيير موعد حجز قام به المراجع نفسه للتو في نفس المحادثة الحالية الجارية (مثال: "غير الموعد للخميس" أو "خليه بـ 7 العصر بدلاً من 4")، يجب عليك استخدام أداة modify_booking فوراً وتمرير تفاصيل الحجز القديم والحجز الجديد لتحديث البيانات في الشيت والتقويم.
    - تحذير صارم: يمنع منعاً باتاً استدعاء create_booking مرة ثانية لنفس الشخص عند طلب التعديل، لتفادي تكرار الحجوزات وتضارب البيانات!
*   التحقق الفوري والذاتي من الاسم الثنائي: بمجرد أن يزودك المراجع باسمه، يجب عليك التحقق من أنه يحتوي على اسمين على الأقل (اسم ثنائي مثل "حسن حيدر" فما فوق). إذا أرسل اسماً مفرداً (مثل "حسن" فقط)، ارفضه فوراً واطلب الاسم الكامل: "عيني الاسم مفرد، يرجى تزويدي باسمك الثنائي أو الكامل (مثال: حسن حيدر) علمود نكدر نكمل الحجز بالسيستم؟".
*   التحقق الفوري والذاتي من رقم الهاتف الحقيقي: بمجرد أن يزودك المراجع برقم هاتفه، يجب عليك التحقق منه فوراً في نفس الثانية وقبل إكمال الحجز أو جدولة الوقت. رقم الهاتف العراقي الصحيح يجب أن يتكون من 11 رقماً ويبدأ بـ (077 أو 078 أو 075). إذا كان الرقم غير مكتمل (مثل 7701234567 المكون من 10 أرقام) أو وهمي أو تسلسلي، ارفضه فوراً في إجابتك واطلب الرقم الصحيح: "عيني الرقم ناقص أو غير صحيح، يرجى تزويدي برقمك الكامل المكون من 11 رقماً (مثال: 077xxxxxxxx) علمود نكدر نكمل الحجز؟". لا تسمح له بجدولة الوقت أو الانتقال لخطوة التثبيت أبداً إلا بعد تقديم رقم صالح.
*   منع التثبيت قبل اكتمال المعلومات: لا تعرض صيغة التأكيد النهائية ولا تستدعي أداة create_booking أبداً إلا بعد أن يعطيك المراجع اسمه الكامل (الثنائي على الأقل) ورقم هاتفه بشكل صريح وصحيح في المحادثة.

---

## 5. بروتوكول تأكيد وتثبيت الحجز النهائي
بمجرد أن يختار المراجع الموعد ويقدم اسمه وهاتفه (بعد التحقق من صحتهما)، قم بتلخيص الحجز فوراً واطلب التأكيد النهائي بعبارة صريحة.

*   صيغة التأكيد الإلزامية (بدون نجوم أو هاشتاغات أو دولار):
    استاذ/ست [الاسم]، هذي معلوماتك وموعدك:
    - الإجراء: [نوع العيادة/الخدمة]
    - الفرع: [اسم الفرع]
    - الموعد: [اليوم والتاريخ والوقت بالتفصيل بصيغة 12 ساعة]
    - الدكتور: [اسم الدكتور الفعلي المحدد بالفرع، ويمنع منعاً باتاً كتابة "أي طبيب متوفر" أو تركها مبهمة]
    تثبت عيوني؟ علمود أسجله بالنظام هسة وتدخل الحجز.

---

## 6. بروتوكول ما بعد الحجز (Post-Booking State) ونجاح التثبيت والتعليمات الطبية
*   رسالة نجاح التثبيت النهائية والتعليمات الطبية المخصصة:
    - بمجرد نجاح الحجز (استدعاء create_booking بنجاح)، يجب أن تقرأ عمود PreAppointmentInstructions للخدمة المحجوزة من جدول Services_Config وتظهره كتعليمات وتوصيات للمريض بآخر الرسالة.
    - صيغة الرسالة الإلزامية:
      "تم تثبيت حجزك عيوني [الاسم] بنجاح! موعدك يوم [اليوم والتاريخ] الساعة [الوقت بصيغة 12 ساعة] بفرع [الفرع] مع الدكتور [اسم الدكتور الفعلي]. 
      وتوصياتنا إلك قبل الحضور: [التعليمات الطبية المكتوبة بعمود PreAppointmentInstructions للخدمة]
      بانتظارك بكل هلا!"
*   بمجرد نجاح الحجز وتأكيده، يدخل الحوار في مرحلة ما بعد الحجز.
*   إذا شكرك المستخدم أو قال عبارات مثل (شكراً، تسلم، عشت، فدوة لعينك، رحم الله والديك) بعد تأكيد الحجز، يجب عليك فقط أن ترحب به بلطف وتتمنى له الصحة والعافية وتؤكد له أنكم بانتظاره في موعده المحدد.
*   يمنع منعاً باتاً سؤاله مرة أخرى عن رغبته في حجز جديد أو إعادة عرض الخدمات عليه أو سؤاله "شلون أكدر أساعدك اليوم"، إلا إذا طلب هو ذلك صراحة بعبارة مثل "أريد أحجز موعد ثاني".

---

## 7. شجرة الردود السريعة وحساب الخصم ديناميكياً
*   حساب وعرض الخصم التلقائي عند السؤال عن الأسعار:
    - اقرأ السعر الأصلي من عمود Price (مثال: 50000) وقيمة الخم من عمود Offer للخدمة المطلوبة (مثال: "خصم 10%").
    - قم بحساب السعر النهائي بعد الخصم ديناميكياً في ذهنك (مثال: خصم 10% على 50,000 يجعل السعر 45,000 دينار).
    - اعرض السعرين بوضوح للمراجع ليشعر بفرق التوفير.
    - الرد النموذجي: "سعر [اسم الخدمة] الأصلي هو [السعر الأصلي] دينار، وحالياً عدنا عرض خصم [الخصم]، فيطلع عليك السعر بعد الخصم [السعر المحسوب] دينار فقط! حاب نحجزلك موعد فحص عليها عيني؟"
*   إذا كانت العيادة مزدحمة جداً أو فشل الحجز بسبب الضغط:
    الرد: "يا عيني اعتذر منك، الموعد هذا صار عليه حجز بنفس الثانية. بلكي نحجز بالموعد البديل [الموعد البديل]؟ أو تحب أجرب أشوفلك بفرعنا الثاني؟"
`;

  private static tools = [
    {
      functionDeclarations: [
        {
          name: 'get_clinic_info',
          description: 'يجلب تفاصيل العيادة مثل قائمة الخدمات والأسعار والعروض أو أوقات الفروع والأطباء وتفاصيلهم من جدول جوجل شيتس.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              tab_name: {
                type: Type.STRING,
                description: 'اسم صفحة الجدول المراد قراءتها (Clinic_Metadata للفروع وساعات العمل، Services_Config للخدمات والأسعار والعروض، Doctors_Config لتفاصيل الأطباء وأيام عملهم وتخصصاتهم وخبرتهم)'
              }
            },
            required: ['tab_name']
          }
        },
        {
          name: 'get_available_slots',
          description: 'يفحص الأوقات المتاحة للحجز في فرع معين وتاريخ محدد بناءً على جدول الطبيب.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              branch: {
                type: Type.STRING,
                description: 'اسم الفرع المطلوب فحص التوافر فيه'
              },
              date: {
                type: Type.STRING,
                description: 'التاريخ المطلوب فحصه بصيغة YYYY-MM-DD'
              },
              service_name: {
                type: Type.STRING,
                description: 'اسم الإجراء أو الخدمة المطلوبة لحساب مدة الجلسة (مثلاً فيلر شفايف، شلع سن)'
              },
              doctor_name: {
                type: Type.STRING,
                description: 'اسم الطبيب المطلوب فحص توافره لتصفية المواعيد بناءً على تقويمه (اختياري)'
              }
            },
            required: ['branch', 'date', 'service_name']
          }
        },
        {
          name: 'create_booking',
          description: 'يثبت حجز مراجع جديد في تقويم جوجل للفرع المحدد ويسجل بياناته في شيت جوجل.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              patient_name: { type: Type.STRING, description: 'اسم المراجع بالكامل (ثنائي على الأقل)' },
              phone: { type: Type.STRING, description: 'رقم هاتف المراجع الحقيقي والكامل المكون من 11 رقماً الذي يقدمه في المحادثة. يمنع منعاً باتاً تخمينه أو وضع رقم افتراضي مثل 07701234567.' },
              branch: { type: Type.STRING, description: 'اسم الفرع الذي سيتم الحجز فيه' },
              service_name: { type: Type.STRING, description: 'نوع الإجراء أو الخدمة المطلوبة' },
              datetime: { type: Type.STRING, description: 'تاريخ ووقت الحجز بالتفصيل بصيغة ISO مع الأوفست (مثال: 2026-06-20T16:00:00+03:00)' },
              notes: { type: Type.STRING, description: 'أي ملاحظات إضافية يذكرها المراجع' },
              doctor_name: { type: Type.STRING, description: 'اسم الطبيب المفضل للحجز (اختياري)' }
            },
            required: ['patient_name', 'phone', 'branch', 'service_name', 'datetime']
          }
        },
        {
          name: 'modify_booking',
          description: 'يعدل أو ينقل موعد حجز قائم في نفس المحادثة إلى موعد جديد في تقويم جوجل وجدول الشيت.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              patient_name: { type: Type.STRING, description: 'اسم المراجع بالكامل (ثنائي على الأقل)' },
              phone: { type: Type.STRING, description: 'رقم هاتف المراجع المكون من 11 رقماً' },
              old_datetime: { type: Type.STRING, description: 'تاريخ ووقت الحجز القديم المراد تعديله بصيغة ISO (مثال: 2026-06-20T16:00:00+03:00)' },
              new_datetime: { type: Type.STRING, description: 'تاريخ ووقت الحجز الجديد المطلوب بصيغة ISO مع الأوفست (مثال: 2026-06-21T17:00:00+03:00)' },
              branch: { type: Type.STRING, description: 'اسم الفرع الذي تم الحجز فيه' },
              doctor_name: { type: Type.STRING, description: 'اسم الطبيب الجديد للحجز (اختياري)' }
            },
            required: ['patient_name', 'phone', 'old_datetime', 'new_datetime', 'branch']
          }
        }
      ]
    }
  ];

  public static async uploadAudioFile(localPath: string, mimeType: string, apiKey?: string): Promise<{ uri: string; mimeType: string } | null> {
    const activeKey = apiKey || config.gemini.apiKey;
    if (!activeKey) return null;
    try {
      console.log(`🎙️ Uploading audio file to Gemini Files API: ${localPath}...`);
      const aiClient = new GoogleGenAI({ apiKey: activeKey });
      const uploadResult = await aiClient.files.upload({
        file: localPath,
        mimeType: mimeType
      } as any);
      console.log(`🎙️ File uploaded successfully: ${uploadResult.uri}`);
      return { uri: uploadResult.uri || '', mimeType: uploadResult.mimeType || mimeType };
    } catch (err: any) {
      console.error('❌ Failed to upload audio file to Gemini:', err.message);
      return null;
    }
  }

  /**
   * Main chat function for handling user turns with session management and tool execution.
   */
  public static async handleChatTurn(
    phoneNumberId: string,
    phoneNumber: string,
    messageInput: string | any[],
    history: any[] = []
  ): Promise<{ responseText: string; updatedHistory: any[] }> {
    // 1. Fetch Tenant configs dynamically
    const tenants = TenantManager.getAllTenants();
    const tenant = tenants[phoneNumberId] || tenants[Object.keys(tenants)[0]];
    const spreadsheetId = tenant?.spreadsheetId;
    const apiKey = tenant?.geminiApiKey || config.gemini.apiKey;

    if (!apiKey) {
      console.warn('⚠️ GEMINI_API_KEY is not defined. Running mock responses.');
      const mockText = this.generateMockResponse(messageInput);
      return { responseText: mockText, updatedHistory: [...history, { role: 'user', parts: [{ text: typeof messageInput === 'string' ? messageInput : 'بصمة صوتية' }] }, { role: 'model', parts: [{ text: mockText }] }] };
    }

    const aiClient = new GoogleGenAI({ apiKey });

    try {
      // Inject current date context into system instructions
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Baghdad' }); // YYYY-MM-DD format
      const dayOfWeek = new Date().toLocaleDateString('ar-IQ', { weekday: 'long', timeZone: 'Asia/Baghdad' });

      const dynamicInstruction = 
        `${this.systemInstruction}\n\n` +
        `## سياق تاريخ اليوم وتوقيت المحادثة الحالي:\n` +
        `*   تاريخ اليوم الحالي هو: ${todayStr} (${dayOfWeek}).\n` +
        `*   اسم العيادة مالتنا هو: ${tenant?.clinicName || 'عيادة ابتسامة البصرة'}.\n` +
        `*   تذكر أنك تقترح مواعيد المراجعين دائماً بدءاً من يوم غد فما فوق لحجز المواعيد.\n` +
        `*   معرّف الشيت مالتنا هو: ${spreadsheetId || 'default'}.`;

      // 2. Initialize chat session with history and system instruction
      const chat = aiClient.chats.create({
        model: this.modelName,
        history,
        config: {
          systemInstruction: dynamicInstruction,
          tools: this.tools as any
        }
      });

      console.log('💬 Sending turn input to Gemini for user: ' + phoneNumber + '...');
      let response = await chat.sendMessage({ message: messageInput });

      // 3. Keep executing tools as long as the model requests them
      let loopCount = 0;
      const maxLoops = 5;

      while (response.functionCalls && response.functionCalls.length > 0 && loopCount < maxLoops) {
        loopCount++;
        const toolResponses: any[] = [];

        for (const call of response.functionCalls) {
          if (!call.args) {
            console.warn('⚠️ Tool call ' + call.name + ' arguments are undefined.');
            continue;
          }
          const args = call.args as Record<string, any>;
          console.log('🛠️ Model requested tool execution: ' + call.name + ' with args:', args);
          let result: any = {};

          try {
            if (call.name === 'get_clinic_info') {
              const tab = args.tab_name as 'Clinic_Metadata' | 'Services_Config' | 'Doctors_Config';
              const info = await GoogleService.getClinicInfo(tab, spreadsheetId);
              result = { data: info };
            } else if (call.name === 'get_available_slots') {
              const branch = args.branch as string;
              const date = args.date as string;
              const service = args.service_name as string;
              const doctor = args.doctor_name as string || undefined;

              const services = await GoogleService.getClinicInfo('Services_Config', spreadsheetId);
              
              // Normalize and match services
              const normService = GoogleService.normalizeArabicText(service);
              const matchedService = services.find(s => {
                const normName = GoogleService.normalizeArabicText(s.name);
                return normName.includes(normService) || normService.includes(normName);
              });
              
              const duration = matchedService ? matchedService.duration : 30;

              const slots = await GoogleService.checkCalendarAvailability(branch, date, duration, spreadsheetId, doctor);
              result = { slots };
            } else if (call.name === 'create_booking') {
              const patientName = args.patient_name as string;
              const phone = args.phone as string;
              const branch = args.branch as string;
              const service = args.service_name as string;
              const datetime = args.datetime as string;
              const notes = (args.notes as string) || '';
              let doctorName = (args.doctor_name as string) || '';

              // Strict validation on backend too to prevent fake phone numbers or incomplete names
              if (!phone || phone.trim() === '' || phone === '07701234567' || phone.includes('1234567')) {
                throw new Error('رقم الهاتف غير صالح أو وهمي. يرجى طلب رقم الهاتف الفعلي المكون من 11 رقماً من المستخدم.');
              }

              const nameParts = patientName.trim().split(/\s+/);
              if (nameParts.length < 2) {
                throw new Error('الاسم المرفق مفرد وغير مكتمل. يرجى طلب الاسم الثنائي على الأقل من المستخدم.');
              }

              // Load clinic metadata to dynamically balance/assign less busy doctor if not specified
              const metadata = await GoogleService.getClinicInfo('Clinic_Metadata', spreadsheetId);
              const branchInfo = metadata.find(m => m.branch.includes(branch) || branch.includes(m.branch));

              if (!doctorName || doctorName.includes('أي طبيب') || doctorName.trim() === '') {
                if (branchInfo && branchInfo.doctors && branchInfo.doctors.length > 0) {
                  const calendarIds = branchInfo.calendarId
                    ? branchInfo.calendarId.split(/,|\n|\r\n/).map((s: string) => s.trim()).filter((s: string) => s.length > 0)
                    : [];
                  
                  if (calendarIds.length > 1) {
                    let bestDoctor = branchInfo.doctors[0];
                    let minBusyCount = Infinity;
                    const dateStr = datetime.split('T')[0];
                    const auth = await GoogleService.getAuthClient();

                    for (let idx = 0; idx < calendarIds.length; idx++) {
                      const calId = calendarIds[idx];
                      const docName = branchInfo.doctors[idx] || branchInfo.doctors[0];
                      try {
                        const eventsResponse = await google.calendar('v3').events.list({
                          auth,
                          calendarId: calId,
                          timeMin: `${dateStr}T00:00:00+03:00`,
                          timeMax: `${dateStr}T23:59:59+03:00`,
                          singleEvents: true
                        });
                        const busyCount = (eventsResponse.data.items || []).length;
                        if (busyCount < minBusyCount) {
                          minBusyCount = busyCount;
                          bestDoctor = docName;
                        }
                      } catch {
                        // ignore and fallback
                      }
                    }
                    doctorName = bestDoctor;
                  } else {
                    doctorName = branchInfo.doctors[0] || 'د. أحمد';
                  }
                } else {
                  doctorName = 'د. أحمد';
                }
              }

              const services = await GoogleService.getClinicInfo('Services_Config', spreadsheetId);
              const normService = GoogleService.normalizeArabicText(service);
              const matchedService = services.find(s => {
                const normName = GoogleService.normalizeArabicText(s.name);
                return normName.includes(normService) || normService.includes(normName);
              });
              
              const duration = matchedService ? matchedService.duration : 30;

              const booking = {
                patientName,
                phoneNumber: phone,
                branch,
                serviceName: service,
                bookingDatetime: datetime,
                durationMinutes: duration,
                status: 'Confirmed' as const,
                notes,
                doctorName
              };

              const sheetSuccess = await GoogleService.logPatientBooking(booking, spreadsheetId);
              const calSuccess = await GoogleService.createCalendarEvent(booking, spreadsheetId);
              
              result = { success: sheetSuccess && calSuccess, doctorName };
            } else if (call.name === 'modify_booking') {
              const patientName = args.patient_name as string;
              const phone = args.phone as string;
              const oldDatetime = args.old_datetime as string;
              const newDatetime = args.new_datetime as string;
              const branch = args.branch as string;
              const doctor = args.doctor_name as string || undefined;

              const success = await GoogleService.modifyBooking(
                patientName,
                phone,
                oldDatetime,
                newDatetime,
                branch,
                30, // default duration
                doctor,
                spreadsheetId
              );

              result = { success };
            }
          } catch (toolError: any) {
            console.error('❌ Error executing tool ' + call.name + ':', toolError.message);
            result = { success: false, error: toolError.message };
          }

          toolResponses.push({
            functionResponse: {
              name: call.name,
              response: { result }
            }
          });
        }

        console.log('📤 Sending tool results back to Gemini...');
        response = await chat.sendMessage({ message: toolResponses });
      }

      const responseText = response.text || 'عذراً عيني، ما كدرت أفهمك بشكل صحيح. تكدر تعيد الرسالة؟';
      const updatedHistory = chat.getHistory();

      return { responseText, updatedHistory };

    } catch (error: any) {
      console.error('❌ Error in Gemini chat completion:', error.message);
      const errText = 'عذراً عيني، صار خلل فني بسيط بالنظام حالياً. يرجى إعادة المحاولة بعد دقائق، أو التواصل مع إدارة العيادة هاتفياً.';
      return { responseText: errText, updatedHistory: history };
    }
  }

  private static generateMockResponse(messageInput: string | any[]): string {
    const text = typeof messageInput === 'string' 
      ? messageInput 
      : messageInput.map(p => p.text || '').join(' ');

    const lower = text.toLowerCase();
    
    if (lower.includes('حجز') || lower.includes('أحجز') || lower.includes('احجز')) {
      return 'أهلاً بك عيوني، أقرب موعد متاح بفرع الجزائر هو باجر الساعة 4:00 العصر، أو فرع الطويسة الساعة 6:00 العصر. يا هو الينسبك حتى أثبته الك؟';
    }
    if (lower.includes('سعر') || lower.includes('بشكد') || lower.includes('تكلفة')) {
      return 'السعر بدقة يحدده الدكتور بعد الفحص المباشر حسب الحالة، عيوني. تحب نحجزلك موعد فحص؟';
    }
    if (lower.includes('فرع') || lower.includes('عنوان') || lower.includes('وين')) {
      return 'عيوني فروعنا متواجدة بالجزائر والطويسة. يا فرع أقرب الك حتى أشوفلك المواعيد المتوفرة بي؟';
    }
    return 'أهلاً وسهلاً بك بالعيادة عيوني، شلون أكدر أساعدك اليوم؟ تحب نحجزلك موعد فحص أسنان أو تجميل؟';
  }
}
