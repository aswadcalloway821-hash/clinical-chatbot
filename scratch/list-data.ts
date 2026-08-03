import { GoogleSheetsService } from '../src/services/google-sheets.js';

async function main() {
  const t = await GoogleSheetsService.getTenantConfig();
  console.log('== SERVICES ==');
  for (const s of t.services) console.log(`- ${s.name} | dept=${s.department ?? '-'} | doc=${s.doctorName ?? '-'} | branch=${s.branchName ?? '-'}`);
  console.log('\n== DEPARTMENTS ==');
  console.log(t.departments);
  console.log('\n== BRANCHES ==');
  for (const b of t.branches) console.log(`- ${b.name} (${b.id})`);
  console.log('\n== DOCTORS ==');
  for (const d of t.doctors) console.log(`- ${d.name} | branch=${d.branchName ?? d.branchId ?? '-'} | cal=${d.calendarId ?? '-'}`);
}
main().catch(e => console.error('FATAL:', e.message));
