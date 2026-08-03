import { GoogleSheetsService } from '../src/services/google-sheets.js';
import { GeminiService } from '../src/services/gemini.js';

async function main() {
  const tenant = await GoogleSheetsService.getTenantConfig();
  const cases = [
    ['مرحبا', {}],
    ['1', {}],
    ['تبيض أسنان', { branchName: 'فرع الجزائر' }],
    ['اسمي علي حسين', { branchName: 'فرع الجزائر' }],
    ['تبييض أسنان', { branchName: 'فرع الجزائر' }],
    ['كشفية', { branchName: 'فرع الجزائر' }],
  ];
  for (const [msg, slots] of cases as any[]) {
    try {
      const r = await GeminiService.analyzeAndExtractSlots(msg, slots, tenant);
      console.log(`\n[MSG] "${msg}" slots=${JSON.stringify(slots)}`);
      console.log(`  intent: ${r.intent}`);
      console.log(`  extracted: ${JSON.stringify(r.extractedSlots)}`);
    } catch (e: any) {
      console.log(`\n[MSG] "${msg}" ERROR: ${e.message}`);
    }
  }
}
main().catch(e => console.error('FATAL:', e));
