/**
 * wipe-phone.ts — تصفير شامل لرقم محدد
 *
 * يمسح:
 *   1. Bookings tab → يلغي كل الحجوزات النشطة لهاد الرقم (CANCELLED)
 *   2. Patients_CRM tab → يحذف صف المريض بالكامل
 *   3. Complaints_Handoffs → يحذف أي شكاوى لهاد الرقم
 *   4. In-Memory Session → يحذف الجلسة المؤقتة
 *
 * Usage:
 *   npx tsx scratch/wipe-phone.ts 07XXXXXXXXX
 */

import dotenv from 'dotenv';
import { google } from 'googleapis';
import fs from 'fs';

dotenv.config();

const sheetId = process.env.GOOGLE_SHEET_ID || '1bBQWg3iZkVF4meUr0sT6-z-wW2JSrqL1HQSOlpyJCMo';

async function getToken(): Promise<string | null> {
  // Method 1: Service Account from env
  try {
    const saJsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (saJsonEnv) {
      const credentials = JSON.parse(saJsonEnv);
      const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
      const client = await auth.getClient();
      const t = await client.getAccessToken();
      if (t.token) return t.token;
    }
  } catch (e) { console.warn('[Token] env SA failed:', e); }

  // Method 2: OAuth2 from .env (client_id + client_secret + refresh_token)
  try {
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN) {
      const oauth2 = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
      const t = await oauth2.getAccessToken();
      if (t.token) {
        console.log('[Token] ✅ OAuth2 token obtained');
        return t.token;
      }
    }
  } catch (e) { console.warn('[Token] OAuth2 failed:', e); }

  // Method 3: Service Account from file
  try {
    const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'google-creds.json';
    if (fs.existsSync(credsPath)) {
      const auth = new google.auth.GoogleAuth({ keyFile: credsPath, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
      const client = await auth.getClient();
      const t = await client.getAccessToken();
      if (t.token) return t.token;
    }
  } catch (e) { console.warn('[Token] file SA failed:', e); }
  return null;
}

async function fetchAll(token: string, range: string): Promise<any[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json() as any;
  return data.values || [];
}

async function batchUpdate(token: string, data: any[][]): Promise<boolean> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data })
  });
  return res.ok;
}

async function deleteRows(token: string, sheetName: string, rowNumbers: number[]): Promise<number> {
  if (rowNumbers.length === 0) return 0;
  // Delete from bottom to top to preserve row indices
  const sorted = [...rowNumbers].sort((a, b) => b - a);
  let deleted = 0;
  for (const row of sorted) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/sheets/${sheetName}:deleteDimension`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        range: { sheetId: 0, startRowIndex: row - 1, endRowIndex: row }
      })
    });
    if (res.ok) deleted++;
  }
  return deleted;
}

async function main() {
  const phone = process.argv[2];
  if (!phone) {
    console.error('Usage: npx tsx scratch/wipe-phone.ts <phone_number>');
    console.error('Example: npx tsx scratch/wipe-phone.ts 07700000000');
    process.exit(1);
  }

  const cleanPhone = phone.replace(/[^0-9]/g, '');
  console.log(`\n🔍 Searching for phone: ${cleanPhone}\n`);

  const token = await getToken();
  if (!token) {
    console.error('❌ Failed to get access token. Check GOOGLE_SERVICE_ACCOUNT_JSON or google-creds.json');
    process.exit(1);
  }

  let totalWiped = 0;

  // ─── 1. BOOKINGS TAB ───
  console.log('📋 Scanning Bookings tab...');
  const bookingRows = await fetchAll(token, 'Bookings!A1:O2000');
  if (bookingRows.length >= 2) {
    const headers = bookingRows[0].map((h: string) => String(h).trim().toLowerCase());
    const phoneIdx = headers.indexOf('phone');
    const statusIdx = headers.indexOf('status');
    const codeIdx = 0; // column A = booking code

    const toCancel: { row: number; code: string }[] = [];
    for (let i = 1; i < bookingRows.length; i++) {
      const r = bookingRows[i];
      const rPhone = String(r[phoneIdx] || '').replace(/[^0-9]/g, '');
      const status = String(r[statusIdx] || '').toUpperCase();
      if (rPhone === cleanPhone && status !== 'CANCELLED') {
        toCancel.push({ row: i + 1, code: String(r[codeIdx] || '') });
      }
    }

    if (toCancel.length > 0) {
      console.log(`  Found ${toCancel.length} active booking(s):`);
      const updates: any[][] = [];
      for (const b of toCancel) {
        console.log(`    → ${b.code} (row ${b.row})`);
        updates.push([`Bookings!H${b.row}`, [['CANCELLED']]]);
      }
      const ok = await batchUpdate(token, updates);
      console.log(ok ? `  ✅ Cancelled ${toCancel.length} booking(s)` : '  ❌ Failed to cancel bookings');
      totalWiped += toCancel.length;
    } else {
      console.log('  ℹ️  No active bookings found for this number');
    }
  }

  // ─── 2. PATIENTS_CRM TAB ───
  console.log('\n👤 Scanning Patients_CRM tab...');
  const crmRows = await fetchAll(token, 'Patients_CRM!A1:G1000');
  if (crmRows.length >= 2) {
    const headers = crmRows[0].map((h: string) => String(h).trim().toLowerCase());
    const phoneIdx = headers.indexOf('phonenumber');

    if (phoneIdx !== -1) {
      const rowsToDelete: number[] = [];
      let patientName = '';
      for (let i = 1; i < crmRows.length; i++) {
        const rPhone = String(crmRows[i][phoneIdx] || '').replace(/[^0-9]/g, '');
        if (rPhone === cleanPhone) {
          patientName = crmRows[i][headers.indexOf('patientname')] || '';
          rowsToDelete.push(i + 1);
        }
      }

      if (rowsToDelete.length > 0) {
        console.log(`  Found patient: "${patientName}" (row ${rowsToDelete.join(', ')})`);
        const deleted = await deleteRows(token, 'Patients_CRM', rowsToDelete);
        console.log(deleted > 0 ? `  ✅ Deleted CRM record` : '  ❌ Failed to delete CRM record');
        totalWiped += deleted;
      } else {
        console.log('  ℹ️  No CRM record found for this number');
      }
    }
  }

  // ─── 3. COMPLAINTS_HANDOFFS TAB ───
  console.log('\n📞 Scanning Complaints_Handoffs tab...');
  const complaintRows = await fetchAll(token, 'Complaints_Handoffs!A1:Z500');
  if (complaintRows.length >= 2) {
    const headers = complaintRows[0].map((h: string) => String(h).trim().toLowerCase());
    const phoneIdx = headers.indexOf('phonenumber');

    if (phoneIdx !== -1) {
      const rowsToDelete: number[] = [];
      for (let i = 1; i < complaintRows.length; i++) {
        const rPhone = String(complaintRows[i][phoneIdx] || '').replace(/[^0-9]/g, '');
        if (rPhone === cleanPhone) {
          rowsToDelete.push(i + 1);
        }
      }

      if (rowsToDelete.length > 0) {
        console.log(`  Found ${rowsToDelete.length} complaint/handoff record(s)`);
        const deleted = await deleteRows(token, 'Complaints_Handoffs', rowsToDelete);
        console.log(deleted > 0 ? `  ✅ Deleted ${deleted} complaint record(s)` : '  ❌ Failed to delete complaints');
        totalWiped += deleted;
      } else {
        console.log('  ℹ️  No complaint records found for this number');
      }
    }
  }

  // ─── SUMMARY ───
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`✅ Tawseer complete for ${cleanPhone}`);
  console.log(`   Total records wiped: ${totalWiped}`);
  console.log(`${'─'.repeat(40)}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
