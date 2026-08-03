const sheetId = '1bBQWg3iZkVF4meUr0sT6-z-wW2JSrqL1HQSOlpyJCMo';

for (const tab of ['Doctors_Config', 'Bookings', 'Patients_CRM', 'Complaints', 'Analytics']) {
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${tab}`);
    const text = await res.text();
    console.log(`\n=== ${tab} HTTP ${res.status} (${text.length} chars) ===`);
    console.log(text.slice(0, 1500));
  } catch (e: any) {
    console.log(`=== ${tab} ERROR: ${e.message}`);
  }
}
