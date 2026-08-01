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
  public static slice(session: PatientSession, tenant: TenantConfig, userMessage: string, phone: string = ''): SlicedContextPayload {
    const isFirstGreeting = session.currentState === 'GREETING';

    const personaGuidance = `
أنتِ "سارة الرقمية"، موظفة استقبال مركز "${tenant.clinicName}".
تتحدثين بلغة عراقية عفوية وطبيعية ومباشرة مثل أي موظفة استقبال بشرية محترفة على الواتساب.

اليوم هو السبت 1 آب/أغسطس 2026. 

قواعد الاستجابة والتنسيق البصري:
1. اسم العيادة والمركز هو حصراً "${tenant.clinicName}".
2. الفروع والمواقع المتاحة هي حصراً: ${tenant.branches.map(b => b.name).join(' ، ')}.
3. الأطباء المتاحون هم حصراً: ${tenant.doctors.map(d => d.name).join(' ، ')}.
4. ${isFirstGreeting ? 'رحبي بالمراجع مرة واحدة فقط في بداية التفاعل.' : 'أجيبي بشكل مباشر ومختصر جداً بدون أي ترحيب أو مقدمات!'}
5. ممنوع منعاً باتاً إضافة أي جملة ختامية مكررة أو مجاملات زائدة مثل ("اختيار ممتاز", "بالنسبة للخدمات المتوفرة لدينا").
6. نسقي كافة قائمة الخيارات بترقيم عددي بسيط ومريح للعين (1. ... \n2. ... \n3. ...) مع فصل كل نقطة بسطر منفصل.
7. المواعيد تذكر بصيغة تاريخ واضح ودقيق (مثلاً: غداً الأحد 2 آب) ودون استخدام عبارات مضللة مثل "الشهر القادم".
8. إذا قال المراجع "شكراً" أو "ما أريد شي" أو ودعك، أجيبي بلطف: "أهلاً وسهلاً بيك عيني! إذا غيرت رأيك أو احتاجيت أي حجز بـ أي وقت، إحنا بـ الخدمة وموجودين دائماً. يومك سعيد! 🌸".
9. عدم استخدام الرموز أو التنسيقات غير البشرية مثل (*, **, #, ` + '```' + `).
`;

    let stepInstruction = '';
    let stepData: any = {};

    switch (session.currentState) {
      case 'GREETING':
        stepInstruction = 'رحبي بالمراجع بلطف بلهجة عراقية واسأليه عن القسم الطبي أو الخدمة المطلوبة.';
        stepData = {
          departmentsList: (tenant.departments || []).map((d, i) => `${i + 1}. قسم ${d}`).join('\n'),
          branchesList: tenant.branches.map((b, i) => `${i + 1}. ${b.name}`).join('\n')
        };
        break;

      case 'SELECT_DEPARTMENT':
        stepInstruction = 'اعرضي الأقسام الطبية المتوفرة بترقيم عددي واصحي المراجع باختيار قسم.';
        stepData = {
          departmentsList: (tenant.departments || []).map((d, i) => `${i + 1}. قسم ${d}`).join('\n')
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

        const targetBranches = filteredBranches.length > 0 ? filteredBranches : tenant.branches;
        stepInstruction = 'اعرضي الفروع المتاحة بترقيم عددي واطلبي من المراجع اختيار الفرع الأنسب.';
        stepData = {
          branchesList: targetBranches.map((b, i) => `${i + 1}. ${b.name} (${b.address})`).join('\n')
        };
        break;

      case 'SELECT_SERVICE':
        const deptServices = session.selectedDepartment
          ? tenant.services.filter(s => s.department === session.selectedDepartment)
          : tenant.services;

        const availServices = deptServices.length > 0 ? deptServices : tenant.services;
        stepInstruction = 'اعرضي خيارات الخدمات بأسماء وأسعار فقط بترقيم عددي. ونرجح للمراجع كشفية واستشارة عامة دائماً للتشخيص الدقيق.';
        stepData = {
          servicesList: availServices.map((s, i) => `${i + 1}. ${s.name} - ${s.price} دينار`).join('\n'),
          recommendation: 'ننصح المراجع بكشفية واستشارة عامة كخيار أول لتحديد الاحتياج الدقيق'
        };
        break;

      case 'SELECT_DOCTOR':
        const selectedBranchDoctors = tenant.doctors.filter(
          d => (!session.selectedBranchId || d.branchId === session.selectedBranchId || d.branchName === session.selectedBranchName)
        );
        stepInstruction = 'اعرضي الأطباء المتاحين بترقيم عددي عند طلب المراجع فقط.';
        stepData = {
          doctorsList: selectedBranchDoctors.map((d, i) => `${i + 1}. دكتور/دكتورة ${d.name} (${d.specialty})`).join('\n')
        };
        break;

      case 'SELECT_DATE_TIME':
        stepInstruction = 'اعرضي المواعيد المتاحة ضمن دوام الطبيب فقط واطلبي من المراجع التحديد.';
        stepData = {
          selectedDoctor: tenant.doctors.find(d => d.id === session.selectedDoctorId || d.name === session.selectedDoctorName)?.name,
          availableSlots: session.selectedSlot ? [`غداً ${session.selectedSlot.date} الساعة ${session.selectedSlot.startTime}`] : 'مواعيد الدوام الرسمي'
        };
        break;

      case 'COLLECT_PATIENT_NAME':
        stepInstruction = 'اطلبي من المراجع تزويدك باسمه المحترم لتثبيت الموعد.';
        stepData = {};
        break;

      case 'CONFIRMATION_PENDING':
        const branch = session.selectedBranchName || tenant.branches.find(b => b.id === session.selectedBranchId)?.name || '';
        const doctor = session.selectedDoctorName || tenant.doctors.find(d => d.id === session.selectedDoctorId)?.name || '';
        const service = session.selectedServiceName || tenant.services.find(s => s.id === session.selectedServiceId)?.name || '';
        stepInstruction = 'اعرضي ملخص الحجز واطلبي من المراجع التأكيد النهائي.';
        stepData = {
          patientName: session.patientName,
          branch,
          doctor,
          service,
          date: session.selectedSlot?.date,
          time: session.selectedSlot?.startTime
        };
        break;

      case 'CONFIRMED':
        const confBranch = tenant.branches.find(b => b.id === session.selectedBranchId || b.name === session.selectedBranchName) || tenant.branches[0];
        const confService = tenant.services.find(s => s.id === session.selectedServiceId || s.name === session.selectedServiceName) || tenant.services[0];
        const confDoctor = tenant.doctors.find(d => d.id === session.selectedDoctorId || d.name === session.selectedDoctorName) || tenant.doctors[0];
        
        stepInstruction = `أصدري الوصل الرقمي النهائي الأنيق المكتمل بنفس التنسيق التام التالي دون أي اختصار:
تم تثبيت حجزك بنجاح وبشكل نهائي عيني! ✅

📋 تفاصيل موعدك:
- الاسم: ${session.patientName || 'مراجع كريم'}
- رقم الهاتف: ${phone || 'المسجل في الواتساب'}
- الفرع: ${confBranch.name}
- الطبيب: ${confDoctor.name}
- الخدمة: ${confService.name}
- الموعد: غداً ${session.selectedSlot?.date || ''} الساعة ${session.selectedSlot?.startTime || ''}
- كود الحجز: ${session.bookingCode}

📍 رابط خريطة العيادة الجغرافي:
${confBranch.locationLink || 'الفرع الرئيسي'}

⚠️ تعليمات هامة قبل الحضور: ${confService.preAppointmentInstructions || 'يرجى الحضور قبل الموعد بـ 15 دقيقة مصحوباً بالهوية الشخصية.'}

ننتظرك تنورنا بـ العيادة! 🌸`;
        stepData = {
          bookingCode: session.bookingCode,
          patientName: session.patientName,
          serviceName: confService.name,
          locationLink: confBranch.locationLink || '',
          date: session.selectedSlot?.date,
          startTime: session.selectedSlot?.startTime
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
