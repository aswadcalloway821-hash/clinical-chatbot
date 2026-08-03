import dotenv from 'dotenv';
import { google } from 'googleapis';
import fs from 'fs';

dotenv.config();

const sheetId = process.env.GOOGLE_SHEET_ID || '1bBQWg3iZkVF4meUr0sT6-z-wW2JSrqL1HQSOlpyJCMo';

async function getToken(): Promise<string | null> {
  try {
    const saJsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (saJsonEnv) {
      const credentials = JSON.parse(saJsonEnv);
      const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar'] });
      const client = await auth.getClient();
      const t = await client.getAccessToken();
      if (t.token) return t.token;
    }
  } catch (e) { console.warn('env SA failed', e); }

  try {
    const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'google-creds.json';
    if (fs.existsSync(credsPath)) {
      const auth = new google.auth.GoogleAuth({ keyFile: credsPath, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar'] });
      const client = await auth.getClient();
      const t = await client.getAccessToken();
      if (t.token) return t.token;
    }
  } catch (e) { console.warn('file SA failed', e); }
  return null;
}

const tabs = ['Clinic_Metadata', 'Doctors_Config', 'Services_Config', 'Patients_CRM', 'Bookings', 'Complaints', 'Analytics', 'Analytics_Logs'];

async function main() {
  const token = await getToken();
  if (!token) { console.error('NO TOKEN - credentials broken'); return; }
  console.log('Service Account auth: OK');

  for (const tab of tabs) {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${tab}!A1:Z10`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) { console.log(`\n=== ${tab}: HTTP ${res.status} ${await res.text()}`); continue; }
      const data = await res.json() as any;
      const rows = data.values || [];
      console.log(`\n=== ${tab} (${rows.length} rows shown) ===`);
      if (rows.length === 0) { console.log('(empty)'); continue; }
      rows.slice(0, 3).forEach((r: any, i: number) => {
        const cells = (r as any[]).map((c, idx) => `${String.fromCharCode(65 + idx)}=${String(c).slice(0, 30)}`).join(' | ');
        console.log(`row${i}: ${cells}`);
      });
    } catch (e: any) {
      console.log(`\n=== ${tab}: ERROR ${e.message}`);
    }
  }
}

main();
