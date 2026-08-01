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
تتحدثين بلغة عراقية عفوية وطبيعية ومباشرة مثل أي موظفة استقبال بشرية محترفة على الواتساب.

قواعد الاستجابة الدقيقة:
1. اسم العيادة والمركز هو حصراً "${tenant.clinicName}".
2. الفروع والمواقع المتاحة هي حصراً: ${tenant.branches.map(b => b.name).join(' ، ')}.
3. الأطباء المتاحون هم حصراً: ${tenant.doctors.map(d => d.name).join(' ، ')}.
4. ${isFirstGreeting ? 'رحبي بالمراجع مرة واحدة فقط في بداية التفاعل.' : 'أجيبي بشكل مباشر ومختصر جداً بدون أي ترحيب أو مقدمات!'}
5. ممنوع منعاً باتاً إضافة أي جملة ختامية مكررة في نهاية الرد مثل ("أهلاً بك في عيادتنا... كيف أقدر أساعدك اليوم؟").
6. عدم استخدام الرموز أو التنسيقات غير البشرية مثل (*, **, #, ` + '```' + `).
7. التجاوب بأسلوب بشري دافئ ومحترف.
`;

    let stepInstruction = '';
    let stepData: any = {};

    switch (session.currentState) {
      case 'GREETING':
        stepInstruction = 'رحبي بالمراجع بلطف بلهجة عراقية واسأليه عن القسم الطبي أو الفرع المطلوب.';
        stepData = {
          departments: tenant.departments || [],
          branches: tenant.branches.map(b => ({ id: b.id, name: b.name })),
          services: tenant.services.map(s => ({ id: s.id, name: s.name }))
        };
        break;

      case 'SELECT_DEPARTMENT':
        stepInstruction = 'اعرضي الأقسام الطبية المتوفرة واسألي المراجع عن القسم الذي يفضل الحجز فيه.';
        stepData = {
          availableDepartments: tenant.departments || []
        };
        break;

      case 'SELECT_BRANCH':
        const filteredBranches = session.selectedDepartment
          ? tenant.branches.filter(b => {
              const deptServices = tenant.services.filter(s => s.department === session.selectedDepartment);
              const deptDoctors = tenant.doctors.filter(d => deptServices.some(s => s.doctorName === d.name || !s.doctorName));
              return deptDoctors.some(d => d.branchName === b.name || d.branchId === b.id);
            })
          : tenant.branches;

        stepInstruction = 'اعرضي الفروع المتاحة واسألي المراجع عن الفرع المناسب له.';
        stepData = {
          availableBranches: (filteredBranches.length > 0 ? filteredBranches : tenant.branches).map(b => ({ id: b.id, name: b.name, address: b.address }))
        };
        break;

      case 'SELECT_SERVICE':
        const deptServices = session.selectedDepartment
          ? tenant.services.filter(s => s.department === session.selectedDepartment)
          : tenant.services;

        stepInstruction = 'اعرضي الكشفية العامة الاستشارية أو خيارات الخدمات المتاحة واسأليه أيهما يفضل.';
        stepData = {
          services: (deptServices.length > 0 ? deptServices : tenant.services).map(s => ({ id: s.id, name: s.name, price: `${s.price} دينار` }))
        };
        break;

      case 'SELECT_DOCTOR':
        const selectedBranchDoctors = tenant.doctors.filter(
          d => (!session.selectedBranchId || d.branchId === session.selectedBranchId || d.branchName === session.selectedBranchName)
        );
        stepInstruction = 'اعرضي قائمة الأطباء واسألي المراجع عن الطبيب الفاضل الذي يود الحجز عنده.';
        stepData = {
          availableDoctors: selectedBranchDoctors.map(d => ({ id: d.id, name: d.name, specialty: d.specialty }))
        };
        break;

      case 'SELECT_DATE_TIME':
        stepInstruction = 'اعرضي المواعيد المتوفرة القادمة واسألي المراجع عن الوقت الأنسب له.';
        stepData = {
          selectedDoctor: tenant.doctors.find(d => d.id === session.selectedDoctorId || d.name === session.selectedDoctorName)?.name,
          availableSlots: session.selectedSlot ? [session.selectedSlot] : 'يتم توليد المواعيد حسب تقويم الطبيب'
        };
        break;

      case 'COLLECT_PATIENT_NAME':
        stepInstruction = 'اطلبي من المراجع تزويدك باسمه الثلاثي المحترم لتثبيت الموعد.';
        stepData = {};
        break;

      case 'CONFIRMATION_PENDING':
        const branch = session.selectedBranchName || tenant.branches.find(b => b.id === session.selectedBranchId)?.name || '';
        const doctor = session.selectedDoctorName || tenant.doctors.find(d => d.id === session.selectedDoctorId)?.name || '';
        const service = session.selectedServiceName || tenant.services.find(s => s.id === session.selectedServiceId)?.name || '';
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
