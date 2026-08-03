import { GoogleSheetsService } from '../src/services/google-sheets.js';
import { DynamicSlotEngine } from '../src/core/dynamic-slot-engine.js';

async function main() {
  const tenant = await GoogleSheetsService.getTenantConfig();
  const phone = '07700007777';
  console.log('tenant.departments =', JSON.stringify(tenant.departments));
  const msgs = ['جزائر', 'أسنان', 'كشفية'];
  for (const m of msgs) {
    const reply = await DynamicSlotEngine.processMessage(phone, m, tenant);
    console.log(`\n---[USER] ${m}`);
    console.log(`[BOT] ${reply.replace(/\n/g, ' ⏎ ')}`);
    const s = DynamicSlotEngine.getSessionsStore().get(phone);
    if (s) {
      console.log(`STATE: branch=${s.slots?.branchName} dept=${s.slots?.department} svc=${s.slots?.serviceName} doc=${s.slots?.doctorName} time=${s.slots?.startTime} date=${s.slots?.date} pending=${s.pendingProposal} lastPrompt=${s.lastPrompt?.slotType} lastPromptOpts=${JSON.stringify(s.lastPrompt?.options)} dayNote=${s.dayNote ?? '-'} range=${s.preferredTimeRange ? JSON.stringify(s.preferredTimeRange) : '-'}`);
    }
  }
}
main().catch(e => console.error('FATAL:', e.message));
