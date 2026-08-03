import { GoogleSheetsService } from '../src/services/google-sheets.js';
import { DynamicSlotEngine } from '../src/core/dynamic-slot-engine.js';

async function main() {
  const tenant = await GoogleSheetsService.getTenantConfig();
  const phone = '07700007777'; // simulated new patient
  const msgs = [
    'مرحبا',
    'جزائر',
    'أسنان',
    'كشفية',
    'مرحبا اسمي محمود عبد',
  ];
  console.log('======== SIMULATED REAL-LOG FLOW (new engine) ========');
  for (const m of msgs) {
    const reply = await DynamicSlotEngine.processMessage(phone, m, tenant);
    console.log(`\n[USER] ${m}\n[BOT] ${reply}`);
  }
}

main().catch(e => console.error('FATAL:', e));