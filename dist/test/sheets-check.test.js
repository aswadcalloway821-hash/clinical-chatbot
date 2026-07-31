import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GoogleSheetsService } from '../services/google-sheets.js';
describe('Google Sheets Live Tenant Test', () => {
    it('should fetch dynamic tenant config from Google Sheets', async () => {
        const tenant = await GoogleSheetsService.getTenantConfig();
        console.log('--- LIVE SHEET METADATA ---');
        console.log('Clinic Name:', tenant.clinicName);
        console.log('Branches:', tenant.branches);
        console.log('Doctors:', tenant.doctors);
        console.log('Services:', tenant.services);
        console.log('----------------------------');
        assert.ok(tenant.clinicName, 'Clinic name must be present');
        assert.strictEqual(tenant.clinicName.includes('ابتسامة البصرة') || tenant.clinicName.length > 0, true);
    });
});
//# sourceMappingURL=sheets-check.test.js.map