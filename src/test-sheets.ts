import { GoogleService } from './services/google.service';
import { TenantManager } from './config/tenant-manager';

async function run() {
  try {
    const tenants = TenantManager.getAllTenants();
    const firstTenant = Object.values(tenants)[0];
    if (!firstTenant) {
      console.error('No tenants found in tenants.json');
      return;
    }

    console.log(`🔍 Checking Google Sheet ID: ${firstTenant.spreadsheetId} for clinic: ${firstTenant.clinicName}...`);
    
    const metadata = await GoogleService.getClinicInfo('Clinic_Metadata', firstTenant.spreadsheetId);
    console.log('✅ Successfully fetched Clinic_Metadata:', metadata);

    const services = await GoogleService.getClinicInfo('Services_Config', firstTenant.spreadsheetId);
    console.log('✅ Successfully fetched Services_Config:', services.slice(0, 2));

  } catch (err: any) {
    console.error('❌ Error checking sheets:', err.message);
  }
}

run();
