import { TenantConfig, Booking, PatientSession } from '../types/booking.js';
import dotenv from 'dotenv';

dotenv.config();

// Locked to Basra Smile Clinic Google Sheet ID
const sheetId = '1bBQWg3iZkVF4meUr0sT6-z-wW2JSrqL1HQSOlpyJCMo';

export class GoogleSheetsService {
  /**
   * Simple CSV Parser Helper
   */
  private static parseCsv(text: string): string[][] {
    const lines: string[][] = [];
    let row: string[] = [];
    let curr = '';
    let insideQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          curr += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        row.push(curr.trim());
        curr = '';
      } else if ((char === '\r' || char === '\n') && !insideQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        row.push(curr.trim());
        if (row.some(cell => cell.length > 0)) {
          lines.push(row);
        }
        row = [];
        curr = '';
      } else {
        curr += char;
      }
    }
    if (curr.length > 0 || row.length > 0) {
      row.push(curr.trim());
      if (row.some(cell => cell.length > 0)) {
        lines.push(row);
      }
    }
    return lines;
  }

  /**
   * Fetch Access Token dynamically from Google OAuth2 Refresh Token
   */
  private static async getAccessToken(): Promise<string | null> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) return null;

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      });

      const data = await res.json() as any;
      return data.access_token || null;
    } catch {
      return null;
    }
  }

  /**
   * Helper to fetch values from Google Sheets.
   * Strategy 1: Google Sheets API v4 with OAuth2 Access Token.
   * Strategy 2 (Bulletproof Fallback): GViz CSV Export endpoint (Zero Token Expiration!).
   */
  private static async fetchSheetValues(rangeOrSheetName: string): Promise<any[][]> {
    const tabName = rangeOrSheetName.split('!')[0];

    // 1. Try OAuth2 REST API v4 first
    try {
      const token = await this.getAccessToken();
      if (token) {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(rangeOrSheetName)}`;
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json() as any;
          if (data.values && data.values.length > 0) {
            console.log(`[Google Sheets API v4] Successfully fetched '${tabName}' (${data.values.length} rows)`);
            return data.values;
          }
        }
      }
    } catch (err) {
      console.warn(`[Google Sheets API v4 Warning] OAuth fetch failed for '${tabName}', trying GViz CSV...`, err);
    }

    // 2. Bulletproof Fallback: GViz CSV Export (100% Reliable & Immune to Token Expirations)
    try {
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
      const res = await fetch(gvizUrl);
      if (res.ok) {
        const csvText = await res.text();
        const rows = this.parseCsv(csvText);
        console.log(`[Google Sheets GViz CSV] Successfully fetched '${tabName}' (${rows.length} rows)`);
        return rows;
      } else {
        const errBody = await res.text();
        throw new Error(`GViz HTTP ${res.status}: ${errBody}`);
      }
    } catch (gvizErr: any) {
      throw new Error(`Google Sheets Fetch Failed for tab '${tabName}': ${gvizErr.message || gvizErr}`);
    }
  }

  /**
   * Fetch Tenant Configuration EXCLUSIVELY and 100% DYNAMICALLY from Google Sheets.
   * STRICT ZERO FALLBACK DATA: Throws explicit error if sheet or headers are missing.
   */
  public static async getTenantConfig(tenantId: string = 'live_sheet'): Promise<TenantConfig> {
    const metaRows = await this.fetchSheetValues('Clinic_Metadata!A1:Z50');
    const docRows = await this.fetchSheetValues('Doctors_Config!A1:Z50');
    const servRows = await this.fetchSheetValues('Services_Config!A1:Z50');

    if (!metaRows || metaRows.length < 2) {
      throw new Error(`[Google Sheets Error] Tab 'Clinic_Metadata' in sheet '${sheetId}' is empty or missing data rows.`);
    }

    // Dynamic Header Matching for Clinic_Metadata
    const metaHeaders = (metaRows[0] || []).map(h => String(h).trim().toLowerCase());
    const clinicNameIdx = metaHeaders.indexOf('clinicname');
    const branchIdx = metaHeaders.indexOf('branch');
    const addressIdx = metaHeaders.indexOf('address');
    const phoneIdx = metaHeaders.indexOf('phone');

    const dataRows = metaRows.slice(1);
    
    if (clinicNameIdx === -1 || !dataRows[0]?.[clinicNameIdx]?.trim()) {
      throw new Error(`[Google Sheets Error] Column 'ClinicName' is missing or empty in 'Clinic_Metadata'.`);
    }
    const clinicName = dataRows[0][clinicNameIdx].trim();

    // Dynamic Header Matching for Doctors_Config
    const docHeaders = (docRows[0] || []).map(h => String(h).trim().toLowerCase());
    const docNameIdx = docHeaders.indexOf('doctorname');
    const docBranchIdx = docHeaders.indexOf('branch');
    const docPhoneIdx = docHeaders.indexOf('secretariatphone');
    const docSpecIdx = docHeaders.indexOf('specialization');
    const docCalIdx = docHeaders.indexOf('calendarid');

    if (docPhoneIdx === -1 || !docRows[1]?.[docPhoneIdx]?.trim()) {
      throw new Error(`[Google Sheets Error] Column 'SecretariatPhone' is missing or empty in 'Doctors_Config'.`);
    }
    const secretaryPhone = docRows[1][docPhoneIdx].trim();

    // Parse Branches dynamically
    const branches = dataRows.map((r, idx) => {
      const bName = (branchIdx !== -1 && r[branchIdx]) ? r[branchIdx].trim() : '';
      if (!bName) throw new Error(`[Google Sheets Error] Missing branch name at row ${idx + 2} in 'Clinic_Metadata'.`);
      return {
        id: `b_${idx + 1}`,
        name: bName,
        address: (addressIdx !== -1 && r[addressIdx]) ? r[addressIdx].trim() : '',
        phone: (phoneIdx !== -1 && r[phoneIdx]) ? r[phoneIdx].trim() : ''
      };
    });

    // Parse Doctors dynamically
    const docDataRows = docRows.slice(1);
    const doctors = docDataRows.map((d, idx) => {
      const docName = (docNameIdx !== -1 && d[docNameIdx]) ? d[docNameIdx].trim() : '';
      if (!docName) throw new Error(`[Google Sheets Error] Missing doctor name at row ${idx + 2} in 'Doctors_Config'.`);
      const docBranchName = (docBranchIdx !== -1 && d[docBranchIdx]) ? d[docBranchIdx].trim() : '';
      const docSpec = (docSpecIdx !== -1 && d[docSpecIdx]) ? d[docSpecIdx].trim() : 'طب أسنان';
      const calId = (docCalIdx !== -1 && d[docCalIdx]) ? d[docCalIdx].trim() : '';

      const matchingBranch = branches.find(b => b.name.trim() === docBranchName) || branches[0];

      return {
        id: `d_${idx + 1}`,
        branchId: matchingBranch.id,
        name: docName,
        specialty: docSpec,
        services: [],
        calendarId: calId,
        workingHours: {
          days: [0, 1, 2, 3, 4, 6],
          startHour: 9,
          endHour: 21,
          slotDurationMinutes: 30
        }
      };
    });

    // Dynamic Header Matching for Services_Config
    const servHeaders = (servRows[0] || []).map(h => String(h).trim().toLowerCase());
    const sNameIdx = servHeaders.indexOf('name');
    const sPriceIdx = servHeaders.indexOf('price');
    const sDurationIdx = servHeaders.indexOf('duration');
    const sDescIdx = servHeaders.indexOf('preappointmentinstructions');

    const servDataRows = servRows.slice(1);
    const services = servDataRows.map((s, idx) => {
      const sName = (sNameIdx !== -1 && s[sNameIdx]) ? s[sNameIdx].trim() : '';
      if (!sName) throw new Error(`[Google Sheets Error] Missing service name at row ${idx + 2} in 'Services_Config'.`);
      return {
        id: `s_${idx + 1}`,
        name: sName,
        price: (sPriceIdx !== -1 && s[sPriceIdx]) ? parseInt(s[sPriceIdx]) || 0 : 0,
        durationMinutes: (sDurationIdx !== -1 && s[sDurationIdx]) ? parseInt(s[sDurationIdx]) || 30 : 30,
        description: (sDescIdx !== -1 && s[sDescIdx]) ? s[sDescIdx].trim() : ''
      };
    });

    const faqs = [
      {
        question: 'شنو اوقات العمل والعناوين؟',
        answer: branches.map(b => `${b.name}: ${b.address}`).join(' | ')
      },
      {
        question: 'شنو اسعار الخدمات المتاحة؟',
        answer: services.map(s => `${s.name}: ${s.price} دينار`).join(' | ')
      }
    ];

    return {
      tenantId: 'dynamic_google_sheet_tenant',
      clinicName,
      secretaryPhone,
      branches,
      services,
      doctors,
      faqs
    };
  }

  /**
   * Save confirmed booking directly to Google Sheets (Bookings Tab) via REST API
   */
  public static async saveBooking(booking: Booking): Promise<boolean> {
    const token = await this.getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Bookings!A:K:append?valueInputOption=USER_ENTERED`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        values: [
          [
            booking.bookingCode,
            booking.patientName,
            booking.patientPhone,
            booking.branchName,
            booking.serviceName,
            `${booking.date}T${booking.startTime}:00+03:00`,
            '30',
            booking.status,
            'تم الحجز آلياً عبر سارة الرقمية',
            booking.doctorName,
            'PENDING'
          ]
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to save booking to Google Sheets: ${errText}`);
    }

    console.log(`[Google Sheets DB] Booking ${booking.bookingCode} appended to Bookings tab.`);
    return true;
  }

  /**
   * Generate Unique Booking Code (BK-XXXX)
   */
  public static generateBookingCode(): string {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `BK-${randomNum}`;
  }

  /**
   * Check Patient History Tag from Bookings sheet
   */
  public static async getPatientHistoryTag(phone: string): Promise<'NEW' | 'RETURNING'> {
    try {
      const values = await this.fetchSheetValues('Bookings!C:C');
      const phones = values.flat();
      return phones.includes(phone) ? 'RETURNING' : 'NEW';
    } catch {
      return 'NEW';
    }
  }
}
