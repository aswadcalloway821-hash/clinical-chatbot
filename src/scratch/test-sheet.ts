import { GoogleService } from '../services/google.service';
import { TenantManager } from '../config/tenant-manager';
import { google } from 'googleapis';

async function test() {
  console.log('🏁 Starting Google Sheet metadata diagnostic...');
  const tenants = TenantManager.getAllTenants();
  const phoneId = Object.keys(tenants)[0];
  const tenant = tenants[phoneId];
  const spreadsheetId = tenant.spreadsheetId;
  
  const auth = await GoogleService.getAuthClient();
  const sheets = google.sheets('v4');
  
  try {
    // 1. Get spreadsheet metadata (tab names)
    const meta = await sheets.spreadsheets.get({
      auth,
      spreadsheetId
    });
    
    console.log('📄 Sheets found in this spreadsheet:');
    meta.data.sheets?.forEach(s => {
      console.log(` - ${s.properties?.title}`);
    });
    
    // 2. Fetch raw values from the tabs to inspect what is written
    for (const sheet of meta.data.sheets || []) {
      const title = sheet.properties?.title;
      if (!title) continue;
      
      const res = await sheets.spreadsheets.values.get({
        auth,
        spreadsheetId,
        range: `${title}!A1:F5`
      });
      console.log(`\n📊 Raw values for tab "${title}":`);
      console.log(JSON.stringify(res.data.values, null, 2));
    }
  } catch (err: any) {
    console.error('❌ Error during diagnostic:', err.message);
  }
}

test();
