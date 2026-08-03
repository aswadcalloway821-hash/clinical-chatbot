import { GoogleSheetsService } from '../src/services/google-sheets.js';

async function main() {
  try {
    const tenant = await GoogleSheetsService.getTenantConfig();
    console.log('CLINIC:', tenant.clinicName);
    console.log('SECRETARY:', tenant.secretaryPhone);
    console.log('BRANCHES:', tenant.branches.map(b => `${b.name}(${b.workingHours})`));
    console.log('DEPARTMENTS:', tenant.departments);
    console.log('DOCTORS:');
    for (const d of tenant.doctors) {
      console.log(`  ${d.name} | branch=${d.branchName} | spec=${d.specialty} | hours=${d.workingHours.startHour}-${d.workingHours.endHour} | days=[${d.workingHours.days}] | breaks=${d.breakTimes || '-'} | off=${d.offDays?.join(',') || '-'} | cap=${d.dailyPatientCapacity} | cal=${d.calendarId.slice(0, 12)}...`);
    }
    console.log('SERVICES:');
    for (const s of tenant.services) {
      console.log(`  ${s.name} | dept=${s.department} | dur=${s.durationMinutes} | price=${s.price} (${s.priceMin}-${s.priceMax}) | doc=${s.doctorName || '-'}`);
    }
    console.log('FAQS:', tenant.faqs.length);
  } catch (e: any) {
    console.error('TENANT LOAD FAILED:', e.message);
  }
}

main();
