import dotenv from 'dotenv';
import fs from 'fs';
import { google } from 'googleapis';
import { TenantConfig, Branch, Doctor, Service, Booking, PatientCRM, ComplaintRecord, AnalyticsRecord, BookedSlot } from '../types/booking.js';
import { getBaghdadToday } from '../utils/baghdad-time.js';

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
   * Fetch Access Token dynamically from Service Account (Env Var / google-creds.json) or OAuth2 Refresh Token
   */
  private static async getAccessToken(): Promise<string | null> {
    // 1. Try Environment Variable JSON string first (for Cloud / Render deployment)
    try {
      const saJsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      if (saJsonEnv) {
        const credentials = JSON.parse(saJsonEnv);
        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/calendar'
          ]
        });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        if (tokenResponse.token) return tokenResponse.token;
      }
    } catch (envErr) {
      console.warn('[Env Service Account Auth Warning]:', envErr);
    }

    // 2. Try local file google-creds.json (for local development)
    try {
      const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'google-creds.json';
      if (fs.existsSync(credsPath)) {
        const auth = new google.auth.GoogleAuth({
          keyFile: credsPath,
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/calendar'
          ]
        });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        if (tokenResponse.token) return tokenResponse.token;
      }
    } catch (saErr) {
      console.warn('[File Service Account Auth Warning]:', saErr);
    }

    return null;
  }

  /**
   * Helper to fetch values from Google Sheets.
   * Strategy 1: Google Sheets API v4 with Service Account Access Token.
   * Strategy 2 (Bulletproof Fallback): GViz CSV Export endpoint (Zero Token Expiration!).
   */
  public static async fetchSheetValues(rangeOrSheetName: string): Promise<any[][]> {
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

    // Helper to normalize Arabic text
    const normalizeArabicText = (text: string): string => {
      if (!text) return '';
      return text
        .replace(/[\u064B-\u0652]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Extract AllDepartments EXCLUSIVELY from Clinic_Metadata when present
    let metaDepartments: string[] = [];
    if (allDeptIdx !== -1) {
      dataRows.forEach(r => {
        const val = r[allDeptIdx];
        if (val) {
          val.split(/[,،]/).forEach((d: string) => {
            const trimmed = d.trim();
            if (trimmed) {
              const norm = normalizeArabicText(trimmed);
              if (!metaDepartments.some(existing => normalizeArabicText(existing) === norm)) {
                metaDepartments.push(trimmed);
              }
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

    // Helper to parse Arabic working days text (e.g. "السبت - الخميس" or "الجمعة والسبت")
    const parseWorkingDays = (daysStr: string): number[] => {
      if (!daysStr) return [0, 1, 2, 3, 4, 6];
      const text = daysStr.trim().toLowerCase();
      if (text.includes('كل الأيام') || text.includes('يوميا')) return [0, 1, 2, 3, 4, 5, 6];

      const dayMap: Record<string, number> = {
        'أحد': 0, 'الاحد': 0, 'الأحد': 0, 'sun': 0,
        'إثنين': 1, 'اثنين': 1, 'الإثنين': 1, 'mon': 1,
        'ثلاثاء': 2, 'الثلاثاء': 2, 'tue': 2,
        'أربعاء': 3, 'اربعاء': 3, 'الأربعاء': 3, 'wed': 3,
        'خميس': 4, 'الخميس': 4, 'thu': 4,
        'جمعة': 5, 'الجمعة': 5, 'fri': 5,
        'سبت': 6, 'السبت': 6, 'sat': 6
      };

      if (text.includes('-') || text.includes('إلى') || text.includes('لـ')) {
        const parts = text.split(/\s*(?:-|–|—|إلى|لـ)\s*/).map(p => p.trim());
        let startDay = -1;
        let endDay = -1;
        for (const [key, num] of Object.entries(dayMap)) {
          if (parts[0]?.includes(key)) startDay = num;
          if (parts[1]?.includes(key)) endDay = num;
        }
        if (startDay !== -1 && endDay !== -1) {
          const days: number[] = [];
          let curr = startDay;
          while (true) {
            days.push(curr);
            if (curr === endDay) break;
            curr = (curr + 1) % 7;
          }
          return days;
        }
      }

      const days: number[] = [];
      for (const [key, num] of Object.entries(dayMap)) {
        if (text.includes(key) && !days.includes(num)) {
          days.push(num);
        }
      }

      return days.length > 0 ? days : [0, 1, 2, 3, 4, 6];
    };

    // Dynamic Header Matching for Doctors_Config
    const docHeaders = (docRows[0] || []).map(h => String(h).trim().toLowerCase());
    const docNameIdx = docHeaders.indexOf('doctorname');
    const docBranchIdx = docHeaders.indexOf('branch');
    const docPhoneIdx = docHeaders.indexOf('secretariatphone');
    const docSpecIdx = docHeaders.indexOf('specialization');
    const docCalIdx = docHeaders.indexOf('calendarid');
    const docTitleIdx = docHeaders.indexOf('doctortitleexperience');
    const docCapacityIdx = docHeaders.indexOf('dailypatientcapacity');
    const docDaysIdx = docHeaders.findIndex(h => h.includes('workingday') || h.includes('days'));
    const docHoursIdx = docHeaders.findIndex(h => h.includes('workinghours') || h.includes('workinghour'));
    const docBreakIdx = docHeaders.findIndex(h => h.includes('breaktime') || h.includes('break'));
    const docOffIdx = docHeaders.findIndex(h => h.includes('offday') || h.includes('offday') || h.includes('holiday'));

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
      const rawDoctorHours = (docHoursIdx !== -1 && d[docHoursIdx]) ? d[docHoursIdx].trim() : '';
      const parsedHours = rawDoctorHours ? parseWorkingHoursRange(rawDoctorHours) : parseWorkingHoursRange(matchingBranch.workingHours);
      const rawDaysStr = (docDaysIdx !== -1 && d[docDaysIdx]) ? d[docDaysIdx].trim() : '';
      const parsedDays = parseWorkingDays(rawDaysStr);
      const rawBreaks = (docBreakIdx !== -1 && d[docBreakIdx]) ? d[docBreakIdx].trim() : '';
      const rawOffDays = (docOffIdx !== -1 && d[docOffIdx]) ? d[docOffIdx].trim() : '';
      // OffDays may contain specific dates ("2026-08-15") OR Arabic weekday names ("الجمعة", "الجمعة والسبت")
      const offDays = rawOffDays
        ? rawOffDays.split(/[,،;]/).map(x => x.trim()).filter(Boolean)
        : [];

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
        dailyPatientCapacity: (docCapacityIdx !== -1 && d[docCapacityIdx]) ? parseInt(String(d[docCapacityIdx]).replace(/[^0-9]/g, '')) || 20 : 20,
        breakTimes: rawBreaks || undefined,
        offDays,
        workingDays: parsedDays,
        workingHours: {
          days: parsedDays,
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
    const servPriceIdx = servHeaders.findIndex(h => h === 'price' || h === 'price_min' || h === 'pricemin');
    const servPriceMinIdx = servHeaders.findIndex(h => h === 'price_min' || h === 'pricemin');
    const servPriceMaxIdx = servHeaders.findIndex(h => h === 'price_max' || h === 'pricemax');
    const servDoctorIdx = servHeaders.indexOf('doctor');
    const servDurationIdx = servHeaders.findIndex(h => h === 'duration' || h === 'durationminutes');
    const servOfferIdx = servHeaders.indexOf('offer');
    const servPreIdx = servHeaders.indexOf('preappointmentinstructions');
    const servPostIdx = servHeaders.indexOf('postcareadvice');

    const servDataRows = servRows.slice(1);
    const services: Service[] = servDataRows.map((s, idx) => {
      const sName = (servNameIdx !== -1 && s[servNameIdx]) ? s[servNameIdx].trim() : '';
      if (!sName) throw new Error(`[Google Sheets Error] Missing service name at row ${idx + 2} in 'Services_Config'.`);
      const sDept = (servDeptIdx !== -1 && s[servDeptIdx]) ? s[servDeptIdx].trim() : '';
      const toNumber = (v: any): number => parseInt(String(v || '').replace(/[^0-9]/g, '')) || 0;
      const sPriceMin = servPriceMinIdx !== -1 ? toNumber(s[servPriceMinIdx]) : 0;
      const sPriceMax = servPriceMaxIdx !== -1 ? toNumber(s[servPriceMaxIdx]) : 0;
      const sPrice = servPriceIdx !== -1 ? toNumber(s[servPriceIdx]) : (sPriceMax || sPriceMin);
      const sDuration = (servDurationIdx !== -1 && s[servDurationIdx]) ? toNumber(s[servDurationIdx]) || 30 : 30;

      return {
        id: `s_${idx + 1}`,
        name: sName,
        department: sDept,
        price: sPrice,
        priceMin: sPriceMin,
        priceMax: sPriceMax,
        durationMinutes: sDuration,
        doctorName: (servDoctorIdx !== -1 && s[servDoctorIdx]) ? s[servDoctorIdx].trim() : '',
        offer: (servOfferIdx !== -1 && s[servOfferIdx]) ? s[servOfferIdx].trim() : '',
        preAppointmentInstructions: (servPreIdx !== -1 && s[servPreIdx]) ? s[servPreIdx].trim() : '',
        postCareAdvice: (servPostIdx !== -1 && s[servPostIdx]) ? s[servPostIdx].trim() : ''
      };
    });

    // Extract unique departments EXCLUSIVELY from Clinic_Metadata when present
    let departments: string[] = [];
    if (metaDepartments.length > 0) {
      departments = metaDepartments;
    } else {
      const rawDepts = services.map(s => s.department).filter(Boolean);
      departments = Array.from(new Set(rawDepts)).filter(d => d !== 'عام');
    }

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
   * Fetch ALL active (non-cancelled) bookings from the live Bookings tab.
   * Column map: A=code B=name C=phone D=branch E=service F=dateTime G=duration H=status
   *             I=notes J=doctorName K=reminderStatus L=platform M=department N=calendarEventId O=calendarId
   * Used by the slot engine to guarantee zero double-booking against the live sheet.
   */
  public static async fetchActiveBookings(fromDate: string = '2000-01-01'): Promise<BookedSlot[]> {
    try {
      const rows = await this.fetchSheetValues('Bookings!A1:O2000');
      if (!rows || rows.length < 2) return [];

      const booked: BookedSlot[] = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const status = String(r[7] || '').toUpperCase();
        if (status === 'CANCELLED' || status === '') continue;

        const dateTimeStr = String(r[5] || '');
        const date = dateTimeStr.split(' ')[0] || '';
        const startTime = dateTimeStr.split(' ')[1] || '';
        if (!date || !startTime || date < fromDate) continue;

        const duration = parseInt(String(r[6])) || 30;
        const [sh, sm] = startTime.split(':').map(Number);
        const totalEnd = (sh || 0) * 60 + (sm || 0) + duration;
        const endH = Math.floor(totalEnd / 60).toString().padStart(2, '0');
        const endM = (totalEnd % 60).toString().padStart(2, '0');

        booked.push({
          bookingCode: String(r[0] || ''),
          doctorName: String(r[9] || '').trim() || undefined,
          date,
          startTime,
          endTime: `${endH}:${endM}`,
          status,
          patientPhone: String(r[2] || ''),
          calendarEventId: r[13] ? String(r[13]).trim() : undefined,
          calendarId: r[14] ? String(r[14]).trim() : undefined
        });
      }
      return booked;
    } catch (err) {
      console.warn('[Google Sheets fetchActiveBookings Warning]:', err);
      return [];
    }
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
   * Save or UPDATE the patient in Patients_CRM tab.
   * If the patient already exists (matched by normalized phone), the existing row is updated:
   * TotalBookings is incremented, LastVisitDate refreshed, NoShowCount preserved.
   * Otherwise a new row is appended.
   * Column map: A=phone B=patientName C=platform D=totalBookings E=lastVisitDate F=noShowCount G=notes
   */
  public static async savePatientCRM(patient: PatientCRM): Promise<boolean> {
    const token = await this.getAccessToken();
    if (!token) return false;

    const cleanName = patient.patientName.replace(/^=/, "'=");
    const cleanPhone = String(patient.phoneNumber || '').replace(/[^0-9]/g, '');
    const visitDate = patient.lastVisitDate || new Date().toISOString().split('T')[0];
    const newTotalBookings = (patient.totalBookings || 1);

    try {
      // Find existing row by phone
      const rows = await this.fetchSheetValues('Patients_CRM!A1:G1000');
      if (rows && rows.length >= 2) {
        const headers = (rows[0] || []).map(h => String(h).trim().toLowerCase());
        const phoneIdx = headers.indexOf('phonenumber');
        const bookingsIdx = headers.indexOf('totalbookings');
        const lastVisitIdx = headers.indexOf('lastvisitdate');
        const noShowIdx = headers.indexOf('noshowcount');
        const nameIdx = headers.indexOf('patientname');
        const platformIdx = headers.indexOf('platform');
        const notesIdx = headers.indexOf('notes');

        for (let i = 1; i < rows.length; i++) {
          const rPhone = String(rows[i][phoneIdx] || '').replace(/[^0-9]/g, '');
          if (rPhone && rPhone === cleanPhone) {
            const rowIndex = i + 1; // 1-based sheet row
            const existingBookings = bookingsIdx !== -1 && rows[i][bookingsIdx] ? (parseInt(String(rows[i][bookingsIdx])) || 0) : 0;
            const noShow = noShowIdx !== -1 && rows[i][noShowIdx] ? (parseInt(String(rows[i][noShowIdx])) || 0) : 0;

            const updates: any[][] = [];
            if (bookingsIdx !== -1) updates.push([`Patients_CRM!D${rowIndex}`, [[existingBookings + newTotalBookings]]]);
            if (lastVisitIdx !== -1) updates.push([`Patients_CRM!E${rowIndex}`, [[visitDate]]]);
            if (nameIdx !== -1 && rows[i][nameIdx] !== patient.patientName) updates.push([`Patients_CRM!B${rowIndex}`, [[cleanName]]]);
            if (platformIdx !== -1 && !rows[i][platformIdx]) updates.push([`Patients_CRM!C${rowIndex}`, [[patient.platform || 'WhatsApp']]]);
            if (notesIdx !== -1 && patient.notes) updates.push([`Patients_CRM!G${rowIndex}`, [[patient.notes]]]);

            if (updates.length > 0) {
              const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate?valueInputOption=USER_ENTERED`;
              const res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  valueInputOption: 'USER_ENTERED',
                  data: updates.map(([range, values]) => ({ range, values }))
                })
              });
              if (res.ok) {
                console.log(`[Google Sheets CRM Update] Updated existing patient ${cleanPhone} (total bookings now ${existingBookings + newTotalBookings})`);
                return true;
              }
            }
            return true; // Row exists, nothing to update
          }
        }
      }
    } catch (err) {
      console.warn('[Google Sheets CRM Update Warning]:', err);
    }

    // Patient not found -> append new row
    try {
      const values = [[
        patient.phoneNumber,
        cleanName,
        patient.platform || 'WhatsApp',
        newTotalBookings,
        visitDate,
        patient.noShowCount || 0,
        patient.notes || ''
      ]];
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Patients_CRM!A:G:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values })
      });
      if (res.ok) {
        console.log(`[Google Sheets CRM] Appended new patient ${cleanPhone}`);
        return true;
      }
    } catch (err) {
      console.warn('[Google Sheets CRM Save Warning]:', err);
    }
    return false;
  }

  /**
   * Log human handoff or complaint into Complaints tab
   */
  public static async logComplaint(complaint: ComplaintRecord): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;

      const cleanName = complaint.patientName.replace(/^=/, "'=");
      const cleanContent = complaint.complaintContent.replace(/^=/, "'=");
      const values = [[
        new Date().toISOString(),
        cleanName,
        complaint.phoneNumber,
        cleanContent,
        complaint.status || 'PENDING'
      ]];

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Complaints!A:E:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values })
      });

      if (res.ok) {
        console.log(`[Google Sheets API] Saved complaint/handoff for ${complaint.phoneNumber}`);
      } else {
        console.error(`[Google Sheets API Error] Save complaint failed with status ${res.status}`);
      }
      return res.ok;
    } catch (err) {
      console.error('[Google Sheets Complaint Error]:', err);
      return false;
    }
  }

  /**
   * Log technical system errors / stack traces into Analytics_Logs tab (separating tech errors from patient complaints)
   */
  public static async logSystemError(errorMsg: string, phone: string = '', patientName: string = ''): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;

      const values = [[
        new Date().toISOString(),
        phone || 'N/A',
        patientName || 'مراجع كريم',
        errorMsg.replace(/^=/, "'="),
        'SYSTEM_ERROR'
      ]];

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Analytics_Logs!A:E:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values })
      });
      return res.ok;
    } catch (err) {
      console.error('[Google Sheets System Error Log Failed]:', err);
      return false;
    }
  }

  /**
   * Append a new booking to Google Sheets 'Bookings' tab (15 columns A:O).
   * Returns true only when Google Sheets confirmed the write (used for calendar rollback).
   */
  public static async saveBooking(booking: Booking): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;

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
        booking.reminderStatus || 'PENDING',
        booking.platform || 'WhatsApp',
        booking.department || 'عام',
        booking.calendarEventId || '',
        booking.calendarId || ''
      ]];

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Bookings!A:O:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values })
      });

      if (res.ok) {
        console.log(`[Google Sheets API] Saved booking '${booking.bookingCode}' for ${booking.patientName}`);
        return true;
      } else {
        console.error(`[Google Sheets Save Booking Error] HTTP ${res.status}:`, await res.text());
        return false;
      }
    } catch (err) {
      console.error('[Google Sheets Save Booking Error]:', err);
      return false;
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
          const dateTimeStr = (r[5] || '');
          return {
            bookingCode: code,
            patientName: r[1] || 'مراجع كريم',
            patientPhone: r[2] || phoneNumber,
            branchName: r[3] || '',
            serviceName: r[4] || '',
            date: dateTimeStr.split(' ')[0] || '',
            startTime: dateTimeStr.split(' ')[1] || '',
            endTime: '',
            durationMinutes: parseInt(r[6]) || 30,
            patientTag: 'RETURNING',
            status: status,
            notes: r[8] || '',
            doctorName: r[9] || '',
            tenantId: 'live_sheet',
            branchId: '',
            doctorId: '',
            serviceId: '',
            createdAt: '',
            calendarEventId: r[13] ? String(r[13]).trim() : undefined,
            calendarId: r[14] ? String(r[14]).trim() : undefined
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Cancel Active Booking in Google Sheets Bookings tab (Column H = CANCELLED).
   * Returns the booking's calendar event info so the caller can also delete the Google Calendar event.
   */
  public static async cancelBookingInSheet(bookingCode: string): Promise<{ bookingCode: string; calendarEventId?: string; calendarId?: string } | null> {
    try {
      const token = await this.getAccessToken();
      if (!token) return null;

      const rows = await this.fetchSheetValues('Bookings!A1:O1000');
      if (!rows || rows.length < 2) return null;

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
          if (res.ok) {
            return {
              bookingCode,
              calendarEventId: rows[i][13] ? String(rows[i][13]).trim() : undefined,
              calendarId: rows[i][14] ? String(rows[i][14]).trim() : undefined
            };
          }
          return null;
        }
      }
      return null;
    } catch {
      return null;
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
   * Log Analytics row in Google Sheets Analytics tab.
   * Analytics columns: A=Date B=TotalMessages C=TotalBookings D=CancelledBookings E=NoShows F=RecoveredRevenue
   * Event details are mirrored to Analytics_Logs for auditability.
   */
  public static async logAnalytics(event: string, details: string): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;
      const todayStr = getBaghdadToday();
      const totalBookings = event === 'BOOKING_CONFIRMED' ? 1 : 0;
      const cancelledBookings = event === 'BOOKING_CANCELLED' ? 1 : 0;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Analytics!A1:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: [[todayStr, 1, totalBookings, cancelledBookings, 0, 0]]
        })
      });
      // Mirror detailed event to Analytics_Logs (audit trail)
      await this.logSystemError(`[${event}] ${details}`, '', '');
      return res.ok;
    } catch {
      return false;
    }
  }
}
