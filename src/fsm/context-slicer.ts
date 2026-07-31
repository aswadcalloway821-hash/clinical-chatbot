import { PatientSession, TenantConfig } from '../types/booking.js';

export interface SlicedContextPayload {
  step: string;
  clinicName: string;
  stepInstruction: string;
  stepData: any;
  userMessage: string;
  personaGuidance: string;
}

export class ContextSlicer {
  /**
   * Slice current state context to minimize token footprint (70% - 85% reduction)
   */
  public static slice(session: PatientSession, tenant: TenantConfig, userMessage: string): SlicedContextPayload {
    const isFirstGreeting = session.currentState === 'GREETING';

    const personaGuidance = `
أنتِ "سارة الرقمية"، موظفة استقبال مركز "${tenant.clinicName}".
تتحدثين بلغة عراقية بغدادية عفوية وطبيعية ومباشرة مثل أي موظفة استقبال بشرية محترفة على الواتساب.

قواعد صارمة جداً لمنع الهلوسة والتخمين:
1. يُمنع منعاً باتاً ذكر أي اسم مركز طبي أو عيادة غير "${tenant.clinicName}".
2. الفروع المتاحة حصراً للمركز هي: ${tenant.branches.map(b => b.name).join(' ، ')}. يُمنع منعاً باتاً اختراع أو ذكر فروع أخرى مثل (المنصور، الكرادة، بغداد) إطلاقاً لأنها غير موجودة بالعيادة!
3. الأطباء المتاحون حصراً هم: ${tenant.doctors.map(d => d.name).join(' ، ')}.
4. تُمنع إعادة عبارات الترحيب ("هلا بيك"، "نورتنا"، "أهلاً وسهلاً") إذا لم تكن هذه أول رسالة تحية. ${isFirstGreeting ? 'رحبي بالمراجع مرة واحدة فقط في بداية التفاعل.' : 'ممنوع كلياً الترحيب، أجيبي بشكل مباشر ومختصر جداً بدون مقدمات!'}
5. يمنع منعاً باتاً استخدام الرموز أو التنسيقات غير البشرية مثل (*, **, #, ` + '```' + `).
6. لا تكشفي أبداً أنكِ ذكاء اصطناعي أو نموذج آلي.
`;

    let stepInstruction = '';
    let stepData: any = {};

    switch (session.currentState) {
      case 'GREETING':
        stepInstruction = 'رحبي بالمراجع بلطف بلهجة عراقية واسأليه عن الفرع أو التخصص المطلوب.';
        stepData = {
          branches: tenant.branches.map(b => ({ id: b.id, name: b.name })),
          services: tenant.services.map(s => ({ id: s.id, name: s.name }))
        };
        break;

      case 'SELECT_BRANCH':
        stepInstruction = 'اعرضي الفروع المتاحة واسألي المراجع عن الفرع المناسب له.';
        stepData = {
          availableBranches: tenant.branches.map(b => ({ id: b.id, name: b.name, address: b.address }))
        };
        break;

      case 'SELECT_SERVICE':
        stepInstruction = 'اعرضي الخدمات المتوفرة واسألي المراجع عن الخدمة المطلوبة.';
        stepData = {
          services: tenant.services.map(s => ({ id: s.id, name: s.name, price: `${s.price} دينار` }))
        };
        break;

      case 'SELECT_DOCTOR':
        const selectedBranchDoctors = tenant.doctors.filter(
          d => !session.selectedBranchId || d.branchId === session.selectedBranchId
        );
        stepInstruction = 'اعرضي قائمة الأطباء واسألي المراجع عن الطبيب الفاضل الذي يود الحجز عنده.';
        stepData = {
          availableDoctors: selectedBranchDoctors.map(d => ({ id: d.id, name: d.name, specialty: d.specialty }))
        };
        break;

      case 'SELECT_DATE_TIME':
        stepInstruction = 'اعرضي المواعيد المتوفرة القادمة واسألي المراجع عن الوقت الأنسب له.';
        stepData = {
          selectedDoctor: tenant.doctors.find(d => d.id === session.selectedDoctorId)?.name,
          availableSlots: session.selectedSlot ? [session.selectedSlot] : 'يتم توليد السلوتات حسب الطلب'
        };
        break;

      case 'COLLECT_PATIENT_NAME':
        stepInstruction = 'اطلبي من المراجع تزويدك باسمه الثلاثي المحترم لتثبيت الموعد.';
        stepData = {};
        break;

      case 'CONFIRMATION_PENDING':
        const branch = tenant.branches.find(b => b.id === session.selectedBranchId)?.name || '';
        const doctor = tenant.doctors.find(d => d.id === session.selectedDoctorId)?.name || '';
        const service = tenant.services.find(s => s.id === session.selectedServiceId)?.name || '';
        stepInstruction = 'اعرضي ملخص الحجز بوضوح بلهجة عراقية واسأليه هل يؤكد الحجز؟';
        stepData = {
          patientName: session.patientName,
          branch,
          doctor,
          service,
          date: session.selectedSlot?.date,
          time: `${session.selectedSlot?.startTime} - ${session.selectedSlot?.endTime}`
        };
        break;

      case 'CONFIRMED':
        stepInstruction = 'أكدي الحجز للمراجع وزوديه بكود الحجز والتفاصيل والتمني له بالسلامة والصحة.';
        stepData = {
          bookingCode: session.bookingCode,
          patientName: session.patientName
        };
        break;

      case 'HUMAN_HANDOFF':
        stepInstruction = 'أعلمي المراجع باعتذار لطيف وأن السكرتير سيواصل معه مباشرةً مع تزويده برقم الهاتف.';
        stepData = {
          secretaryPhone: tenant.secretaryPhone
        };
        break;
    }

    return {
      step: session.currentState,
      clinicName: tenant.clinicName,
      stepInstruction,
      stepData,
      userMessage,
      personaGuidance
    };
  }
}
