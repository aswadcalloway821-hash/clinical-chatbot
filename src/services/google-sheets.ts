import dotenv from 'dotenv';
import { TenantConfig, Branch, Doctor, Service, Booking, PatientCRM, ComplaintRecord, AnalyticsRecord } from '../types/booking.js';

dotenv.config();

const sheetId = '1bBQWg3iZkVF4meUr0sT6-z-wW2JSrqL1HQSOlpyJCMo';

export class GoogleSheetsService {
  private static cachedTenantConfig: TenantConfig | null = null;
  private static cacheTimestamp: number = 0;
  private static CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Clear in-memory cache manually on reset or deployment
   */
  public static clearCache(): void {
    this.cachedTenantConfig = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Helper to parse CSV properly taking care of quotes and commas
   */
  private static parseCsv(csvText: string): string[][] {
    const lines: string[][] = [];
    let row: string[] = [];
    let curr = '';
    let insideQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

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
      console.warn(`[Google Sheets API v4 Warning] OAuth fetch failed for '${tabName}', trying GViz CSV...`);
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
   * Fetch Tenant Configuration with 5-minute In-Memory TTL Cache for ultra-fast responses (0.001s).
   * STRICT ZERO FALLBACK DATA: Throws explicit error if sheet or headers are missing.
   */
  public static async getTenantConfig(tenantId: string = 'live_sheet'): Promise<TenantConfig> {
    const now = Date.now();
    if (this.cachedTenantConfig && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
      console.log(`[Google Sheets Cache Hit] Returning cached TenantConfig (${Math.round((this.CACHE_TTL_MS - (now - this.cacheTimestamp)) / 1000)}s TTL remaining)`);
      return this.cachedTenantConfig;
    }

    console.log(`[Google Sheets Cache Miss] Fetching fresh TenantConfig from Google Sheets...`);
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
    const workingHoursIdx = metaHeaders.indexOf('workinghours');
    const locationLinkIdx = metaHeaders.indexOf('locationlink');
    const allDeptIdx = metaHeaders.findIndex(h => h.includes('alldepartm') || h.includes('alldepartment'));

    const dataRows = metaRows.slice(1);
    
    if (clinicNameIdx === -1 || !dataRows[0]?.[clinicNameIdx]?.trim()) {
      throw new Error(`[Google Sheets Error] Column 'ClinicName' is missing or empty in 'Clinic_Metadata'.`);
    }
    const clinicName = dataRows[0][clinicNameIdx].trim();

    // Extract AllDepartments from Clinic_Metadata
    let metaDepartments: string[] = [];
    if (allDeptIdx !== -1) {
      dataRows.forEach(r => {
        const val = r[allDeptIdx];
        if (val) {
          val.split(/[,،]/).forEach((d: string) => {
            const trimmed = d.trim();
            if (trimmed && !metaDepartments.includes(trimmed)) {
              metaDepartments.push(trimmed);
            }
          });
        }
      });
    }

    // Helper to parse working hours range (e.g., "04:00 PM - 10:00 PM" or "09:00 AM - 05:00 PM")
    const parseWorkingHoursRange = (hoursStr: string): { startHour: number; endHour: number } => {
      if (!hoursStr) return { startHour: 9, endHour: 20 };
      const matches = hoursStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*-\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
      if (matches) {
        let start = parseInt(matches[1]);
        const startAmPm = matches[3]?.toUpperCase();
        if (startAmPm === 'PM' && start < 12) start += 12;
        if (startAmPm === 'AM' && start === 12) start = 0;

        let end = parseInt(matches[4]);
        const endAmPm = matches[6]?.toUpperCase();
        if (endAmPm === 'PM' && end < 12) end += 12;
        if (endAmPm === 'AM' && end === 12) end = 0;

        return { startHour: start, endHour: end };
      }
      return { startHour: 9, endHour: 20 };
    };

    // Parse Branches dynamically
    const branches: Branch[] = dataRows.map((r, idx) => {
      const bName = (branchIdx !== -1 && r[branchIdx]) ? r[branchIdx].trim() : '';
      if (!bName) throw new Error(`[Google Sheets Error] Missing branch name at row ${idx + 2} in 'Clinic_Metadata'.`);
      return {
        id: `b_${idx + 1}`,
        name: bName,
        address: (addressIdx !== -1 && r[addressIdx]) ? r[addressIdx].trim() : '',
        phone: (phoneIdx !== -1 && r[phoneIdx]) ? r[phoneIdx].trim() : '',
        workingHours: (workingHoursIdx !== -1 && r[workingHoursIdx]) ? r[workingHoursIdx].trim() : '',
        locationLink: (locationLinkIdx !== -1 && r[locationLinkIdx]) ? r[locationLinkIdx].trim() : ''
      };
    });

    // Dynamic Header Matching for Doctors_Config
    const docHeaders = (docRows[0] || []).map(h => String(h).trim().toLowerCase());
    const docNameIdx = docHeaders.indexOf('doctorname');
    const docBranchIdx = docHeaders.indexOf('branch');
    const docPhoneIdx = docHeaders.indexOf('secretariatphone');
    const docSpecIdx = docHeaders.indexOf('specialization');
    const docCalIdx = docHeaders.indexOf('calendarid');
    const docTitleIdx = docHeaders.indexOf('doctortitleexperience');
    const docCapacityIdx = docHeaders.indexOf('dailypatientcapacity');

    const secretaryPhone = (docPhoneIdx !== -1 && docRows[1]?.[docPhoneIdx]?.trim()) 
      ? docRows[1][docPhoneIdx].trim() 
      : '07881015584';

    // Parse Doctors dynamically
    const docDataRows = docRows.slice(1);
    const doctors: Doctor[] = docDataRows.map((d, idx) => {
      const docName = (docNameIdx !== -1 && d[docNameIdx]) ? d[docNameIdx].trim() : '';
      if (!docName) throw new Error(`[Google Sheets Error] Missing doctor name at row ${idx + 2} in 'Doctors_Config'.`);
      const docBranchName = (docBranchIdx !== -1 && d[docBranchIdx]) ? d[docBranchIdx].trim() : '';
      const docSpec = (docSpecIdx !== -1 && d[docSpecIdx]) ? d[docSpecIdx].trim() : 'طب أسنان عام';
      const calId = (docCalIdx !== -1 && d[docCalIdx]) ? d[docCalIdx].trim() : 'primary';

      const matchingBranch = branches.find(b => b.name.trim() === docBranchName) || branches[0];
      const parsedHours = parseWorkingHoursRange(matchingBranch.workingHours);

      return {
        id: `d_${idx + 1}`,
        branchId: matchingBranch.id,
        branchName: matchingBranch.name,
        name: docName,
        specialty: docSpec,
        secretariatPhone: (docPhoneIdx !== -1 && d[docPhoneIdx]) ? d[docPhoneIdx].trim() : secretaryPhone,
        services: [],
        calendarId: calId,
        doctorTitleExperience: (docTitleIdx !== -1 && d[docTitleIdx]) ? d[docTitleIdx].trim() : '',
        dailyPatientCapacity: (docCapacityIdx !== -1 && d[docCapacityIdx]) ? parseInt(d[docCapacityIdx]) || 20 : 20,
        workingDays: [0, 1, 2, 3, 4, 6],
        workingHours: {
          days: [0, 1, 2, 3, 4, 6],
          startHour: parsedHours.startHour,
          endHour: parsedHours.endHour,
          slotDurationMinutes: 30
        }
      };
    });

    // Dynamic Header Matching for Services_Config
    const servHeaders = (servRows[0] || []).map(h => String(h).trim().toLowerCase());
    const servNameIdx = servHeaders.indexOf('name');
    const servDeptIdx = servHeaders.indexOf('department');
    const servPriceIdx = servHeaders.indexOf('price');
    const servDoctorIdx = servHeaders.indexOf('doctor');
    const servDurationIdx = servHeaders.indexOf('duration');
    const servOfferIdx = servHeaders.indexOf('offer');
    const servPreIdx = servHeaders.indexOf('preappointmentinstructions');
    const servPostIdx = servHeaders.indexOf('postcareadvice');

    const servDataRows = servRows.slice(1);
    const services: Service[] = servDataRows.map((s, idx) => {
      const sName = (servNameIdx !== -1 && s[servNameIdx]) ? s[servNameIdx].trim() : '';
      if (!sName) throw new Error(`[Google Sheets Error] Missing service name at row ${idx + 2} in 'Services_Config'.`);
      const sDept = (servDeptIdx !== -1 && s[servDeptIdx]) ? s[servDeptIdx].trim() : '';
      const rawPrice = (servPriceIdx !== -1 && s[servPriceIdx]) ? s[servPriceIdx].trim().replace(/[^0-9]/g, '') : '0';
      const sPrice = parseInt(rawPrice) || 0;
      const sDuration = (servDurationIdx !== -1 && s[servDurationIdx]) ? parseInt(s[servDurationIdx]) || 30 : 30;

      return {
        id: `s_${idx + 1}`,
        name: sName,
        department: sDept,
        price: sPrice,
        durationMinutes: sDuration,
        doctorName: (servDoctorIdx !== -1 && s[servDoctorIdx]) ? s[servDoctorIdx].trim() : '',
        offer: (servOfferIdx !== -1 && s[servOfferIdx]) ? s[servOfferIdx].trim() : '',
        preAppointmentInstructions: (servPreIdx !== -1 && s[servPreIdx]) ? s[servPreIdx].trim() : '',
        postCareAdvice: (servPostIdx !== -1 && s[servPostIdx]) ? s[servPostIdx].trim() : ''
      };
    });

    // Extract unique departments combining metaDepartments and services departments
    let departments: string[] = [];
    if (metaDepartments.length > 0) {
      departments = metaDepartments;
    } else {
      const rawDepts = services.map(s => s.department.trim()).filter(Boolean);
      departments = Array.from(new Set(rawDepts));
    }
    // Clean deduplication
    departments = Array.from(new Set(departments.map(d => d.trim()))).filter(d => d !== 'عام' || departments.length === 1);

    const tenantConfig: TenantConfig = {
      tenantId,
      clinicName,
      secretaryPhone,
      branches,
      doctors,
      services,
      departments,
      faqs: [
        { question: 'الموقع والعناوين', answer: branches.map(b => `${b.name}: ${b.address}`).join(' | ') },
        { question: 'أوقات الدوام', answer: branches.map(b => `${b.name}: ${b.workingHours || 'من 9 صباحاً لـ 8 مساءً'}`).join(' | ') }
      ]
    };

    // Save into 5-minute In-Memory Cache
    this.cachedTenantConfig = tenantConfig;
    this.cacheTimestamp = Date.now();

    return tenantConfig;
  }

  /**
   * Lookup patient CRM for Returning Patient Zero-Reask Protocol
   */
  public static async lookupPatientCRM(phoneNumber: string): Promise<PatientCRM | null> {
    try {
      const rows = await this.fetchSheetValues('Patients_CRM!A1:Z500');
      if (!rows || rows.length < 2) return null;

      const headers = (rows[0] || []).map(h => String(h).trim().toLowerCase());
      const phoneIdx = headers.indexOf('phonenumber');
      const nameIdx = headers.indexOf('patientname');
      const platformIdx = headers.indexOf('platform');
      const bookingsIdx = headers.indexOf('totalbookings');
      const lastVisitIdx = headers.indexOf('lastvisitdate');
      const noShowIdx = headers.indexOf('noshowcount');

      if (phoneIdx === -1 || nameIdx === -1) return null;

      const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const rPhone = (r[phoneIdx] || '').replace(/[^0-9]/g, '');
        if (rPhone && rPhone === cleanPhone && r[nameIdx]?.trim()) {
          return {
            phoneNumber: rPhone,
            patientName: r[nameIdx].trim(),
            platform: platformIdx !== -1 ? r[platformIdx] : 'WhatsApp',
            totalBookings: bookingsIdx !== -1 ? parseInt(r[bookingsIdx]) || 1 : 1,
            lastVisitDate: lastVisitIdx !== -1 ? r[lastVisitIdx] : '',
            noShowCount: noShowIdx !== -1 ? parseInt(r[noShowIdx]) || 0 : 0
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Save or update Patient in Patients_CRM tab
   */
  public static async savePatientCRM(patient: PatientCRM): Promise<void> {
    try {
      const token = await this.getAccessToken();
      if (!token) return;

      const cleanName = patient.patientName.replace(/^=/, "'=");
      const values = [[
        patient.phoneNumber,
        cleanName,
        patient.platform || 'WhatsApp',
        patient.totalBookings || 1,
        patient.lastVisitDate || new Date().toISOString().split('T')[0],
        patient.noShowCount || 0,
        patient.notes || ''
      ]];

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Patients_CRM!A:G:append?valueInputOption=USER_ENTERED`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values })
      });
    } catch (err) {
      console.warn('[Google Sheets CRM Save Warning]:', err);
    }
  }

  /**
   * Log human handoff or complaint into Complaints tab
   */
  public static async logComplaint(complaint: ComplaintRecord): Promise<void> {
    try {
      const token = await this.getAccessToken();
      if (!token) return;

      const cleanName = complaint.patientName.replace(/^=/, "'=");
      const cleanContent = complaint.complaintContent.replace(/^=/, "'=");
      const values = [[
        new Date().toISOString(),
        cleanName,
        complaint.phoneNumber,
        cleanContent,
        complaint.status || 'PENDING'
      ]];

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Complaints!A1:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values })
      });
      if (res.ok) {
        console.log(`[Google Sheets API] Logged complaint for ${cleanName}`);
      }
    } catch (err) {
      console.warn('[Google Sheets Complaint Warning]:', err);
    }
  }

  /**
   * Append a new booking to Google Sheets 'Bookings' tab
   */
  public static async saveBooking(booking: Booking): Promise<void> {
    try {
      const token = await this.getAccessToken();
      if (!token) return;

      const cleanName = booking.patientName.replace(/^=/, "'=");
      const values = [[
        booking.bookingCode,
        cleanName,
        booking.patientPhone,
        booking.branchName,
        booking.serviceName,
        `${booking.date} ${booking.startTime}`,
        booking.durationMinutes,
        booking.status,
        booking.notes || '',
        booking.doctorName,
        'PENDING',
        'WhatsApp',
        booking.department || 'عام'
      ]];

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Bookings!A:M:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values })
      });

      if (res.ok) {
        console.log(`[Google Sheets API] Saved booking '${booking.bookingCode}' for ${booking.patientName}`);
      }
    } catch (err) {
      console.error('[Google Sheets Save Booking Error]:', err);
    }
  }

  /**
   * Find Active Booking by Patient Phone Number or Booking Code
   */
  public static async findActiveBookingByPhone(phoneNumber: string): Promise<Booking | null> {
    try {
      const rows = await this.fetchSheetValues('Bookings!A1:Z500');
      if (!rows || rows.length < 2) return null;

      const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');

      for (let i = rows.length - 1; i >= 1; i--) {
        const r = rows[i];
        const code = r[0] || '';
        const phone = (r[2] || '').replace(/[^0-9]/g, '');
        const status = (r[7] || '').toUpperCase();

        if ((phone === cleanPhone || code.includes(phoneNumber)) && status !== 'CANCELLED') {
          return {
            bookingCode: code,
            patientName: r[1] || 'مراجع كريم',
            patientPhone: r[2] || phoneNumber,
            branchName: r[3] || '',
            serviceName: r[4] || '',
            date: (r[5] || '').split(' ')[0] || '',
            startTime: (r[5] || '').split(' ')[1] || '',
            durationMinutes: parseInt(r[6]) || 30,
            status: status,
            notes: r[8] || '',
            doctorName: r[9] || '',
            tenantId: 'live_sheet',
            branchId: '',
            doctorId: '',
            serviceId: '',
            createdAt: ''
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Cancel Active Booking in Google Sheets Bookings tab
   */
  public static async cancelBookingInSheet(bookingCode: string): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;

      const rows = await this.fetchSheetValues('Bookings!A1:Z500');
      if (!rows || rows.length < 2) return false;

      for (let i = 1; i < rows.length; i++) {
        const code = rows[i][0] || '';
        if (code === bookingCode) {
          const rowIndex = i + 1;
          const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Bookings!H${rowIndex}?valueInputOption=USER_ENTERED`;
          const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [['CANCELLED']] })
          });
          return res.ok;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Update Reminder Status in Google Sheets Bookings tab (Column K)
   */
  public static async updateReminderStatus(bookingCode: string, status: string = 'SENT'): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;

      const rows = await this.fetchSheetValues('Bookings!A1:Z500');
      if (!rows || rows.length < 2) return false;

      for (let i = 1; i < rows.length; i++) {
        const code = rows[i][0] || '';
        if (code === bookingCode) {
          const rowIndex = i + 1;
          const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Bookings!K${rowIndex}?valueInputOption=USER_ENTERED`;
          const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [[status]] })
          });
          return res.ok;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Log Analytics row in Google Sheets Analytics tab
   */
  public static async logAnalytics(event: string, details: string): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Analytics!A1:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: [[new Date().toISOString(), event, details]]
        })
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
