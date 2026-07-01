import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

// Interface for Patient Booking Data
export interface BookingData {
  bookingId?: string;
  patientName: string;
  phoneNumber: string;
  branch: string;
  serviceName: string;
  bookingDatetime: string; // ISO String (e.g. "2026-06-20T16:00:00Z")
  durationMinutes: number;
  status: 'Confirmed' | 'Cancelled';
  notes?: string;
  doctorName?: string; // Optional preferred doctor
}

// In-Memory mock bookings database to act as fallback when Google APIs are not connected
const mockBookings: BookingData[] = [];

// Static mock clinic data to use as fallback with doctor lists per branch
const mockClinicMetadata = [
  { branch: 'الكرادة', address: 'بغداد - الكرادة داخل', workingHours: '3:00 PM - 9:00 PM', phone: '07700000000', calendarId: 'mock_cal_karrada', doctors: ['د. مصطفى الونداوي', 'د. نور العزاوي', 'د. سارة البياتي'] },
  { branch: 'المنصور', address: 'بغداد - شارع الرواد', workingHours: '2:00 PM - 10:00 PM', phone: '07800000000', calendarId: 'mock_cal_mansour', doctors: ['د. مصطفى الونداوي', 'د. سارة البياتي', 'د. علي الجبوري'] }
];

const mockServicesConfig = [
  { name: 'فيلر شفايف', type: 'Cosmetic', price: '150,000 IQD', duration: 30, offer: 'خصم 10% بمناسبة العيد', doctors: ['د. سارة البياتي'] },
  { name: 'شلع سن', type: 'Dental', price: '50,000 IQD', duration: 45, offer: 'لا يوجد', doctors: ['د. مصطفى الونداوي', 'د. علي الجبوري'] },
  { name: 'تنظيف أسنان', type: 'Dental', price: '40,000 IQD', duration: 30, offer: 'تنظيف مجاني مع تبييض الأسنان', doctors: ['د. مصطفى الونداوي', 'د. نور العزاوي'] },
  { name: 'تبييض أسنان', type: 'Dental', price: '120,000 IQD', duration: 60, offer: 'يشمل تنظيف مجاني', doctors: ['د. مصطفى الونداوي', 'د. نور العزاوي', 'د. سارة البياتي'] },
  { name: 'بوتوكس جبهة', type: 'Cosmetic', price: '100,000 IQD', duration: 20, offer: 'لا يوجد', doctors: ['د. سارة البياتي'] }
];

export class GoogleService {
  private static sheets = google.sheets('v4');
  private static calendar = google.calendar('v3');
  private static authClient: any = null;
  private static isMockMode = true;

  static {
    this.initializeAuth();
  }

  /**
   * Helper to return the authorized auth client.
   */
  public static async getAuthClient(): Promise<any> {
    if (!this.authClient) return null;
    return typeof this.authClient.getClient === 'function'
      ? await this.authClient.getClient()
      : this.authClient;
  }

  /**
   * Helper to convert Date to Baghdad local time ISO string without Z, explicitly forcing timezone offset.
   */
  public static toBaghdadISOString(date: Date): string {
    const offsetMinutes = 180; // UTC+3
    const localTime = new Date(date.getTime() + offsetMinutes * 60 * 1000);
    const iso = localTime.toISOString(); 
    return iso.substring(0, 19) + '+03:00';
  }

  public static toHumanReadableDateTime(isoStr: string): string {
    try {
      const date = new Date(isoStr);
      const offsetMinutes = 180; // UTC+3
      const localTime = new Date(date.getTime() + offsetMinutes * 60 * 1000);
      const yyyy = localTime.getUTCFullYear();
      const mm = String(localTime.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(localTime.getUTCDate()).padStart(2, '0');
      
      let hours = localTime.getUTCHours();
      const minutes = String(localTime.getUTCMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const hh = String(hours).padStart(2, '0');
      
      return `${yyyy}-${mm}-${dd} ${hh}:${minutes} ${ampm}`;
    } catch {
      return isoStr;
    }
  }

  /**
   * Normalizes Arabic text to handle Alefs, Taa Marbouta, Spaces, etc.
   */
  public static normalizeArabicText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي');
  }

  /**
   * Increments a booking ID sequentially in AAA1 -> AAA999 -> AAB1 format.
   */
  public static incrementBookingId(lastId: string): string {
    const match = lastId.toUpperCase().trim().match(/^([A-Z]{3})(\d+)$/);
    if (!match) {
      return 'AAA1';
    }

    const letters = match[1];
    let num = parseInt(match[2], 10);

    if (num < 999) {
      num += 1;
      return `${letters}${num}`;
    } else {
      // Increment 3-letter base-26 representation
      const chars = letters.split('');
      for (let i = chars.length - 1; i >= 0; i--) {
        const code = chars[i].charCodeAt(0);
        if (code < 90) { // 'Z' is 90
          chars[i] = String.fromCharCode(code + 1);
          return `${chars.join('')}1`;
        } else {
          chars[i] = 'A';
        }
      }
      return 'AAA1'; // Wrap around fallback
    }
  }

  /**
   * Initializes Google Auth if credentials exist, otherwise switches to mock mode.
   */
  private static initializeAuth() {
    try {
      const credsPath = config.google.credentialsPath;
      const tokenPath = path.join(process.cwd(), 'token.json');

      if (fs.existsSync(credsPath)) {
        const credsContent = fs.readFileSync(credsPath, 'utf8');
        const credentials = JSON.parse(credsContent);

        if (credentials.type === 'service_account') {
          console.log(`🔑 Loading Google Service Account credentials from file: ${credsPath}`);
          const auth = new google.auth.GoogleAuth({
            keyFile: credsPath,
            scopes: [
              'https://www.googleapis.com/auth/spreadsheets',
              'https://www.googleapis.com/auth/calendar'
            ]
          });
          this.authClient = auth;
          this.isMockMode = false;
          console.log('✅ Google API Service Account client initialized successfully.');
        } else if (credentials.installed || credentials.web) {
          console.log(`🔑 Detected OAuth2 Client ID credentials from file: ${credsPath}`);
          const clientSecret = credentials.installed || credentials.web;
          const oauth2Client = new google.auth.OAuth2(
            clientSecret.client_id,
            clientSecret.client_secret,
            clientSecret.redirect_uris ? clientSecret.redirect_uris[0] : 'http://localhost'
          );

          if (fs.existsSync(tokenPath)) {
            console.log(`🔑 Loading saved OAuth2 tokens from file: ${tokenPath}`);
            const tokenContent = fs.readFileSync(tokenPath, 'utf8');
            const tokens = JSON.parse(tokenContent);
            oauth2Client.setCredentials(tokens);

            oauth2Client.on('tokens', (newTokens) => {
              try {
                const currentTokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
                const mergedTokens = { ...currentTokens, ...newTokens };
                fs.writeFileSync(tokenPath, JSON.stringify(mergedTokens, null, 2), 'utf8');
                console.log('💾 OAuth2 tokens refreshed and saved successfully.');
              } catch (err: any) {
                console.error('❌ Failed to save refreshed tokens:', err.message);
              }
            });

            this.authClient = oauth2Client;
            this.isMockMode = false;
            console.log('✅ Google API OAuth2 client initialized successfully with token.json.');
          } else {
            console.warn(`⚠️ Detected OAuth2 Client ID but no token.json found at: ${tokenPath}.\n🤖 Staying in mock mode until token.json is created.`);
            this.isMockMode = true;
          }
        } else {
          console.warn(`⚠️ Unknown Google credentials format in: ${credsPath}. Staying in mock mode.`);
          this.isMockMode = true;
        }
      } else {
        console.warn(
          `⚠️ WARNING: Google credentials file not found at: ${credsPath}.\n` +
          `🤖 Switching Google Service to [MOCK FALLBACK MODE]. You can still test the bot fully!`
        );
        this.isMockMode = true;
      }
    } catch (error: any) {
      console.error('❌ Error initializing Google Auth, using Mock fallback:', error.message);
      this.isMockMode = true;
    }
  }

  /**
   * Reads clinic info, doctor configurations, or FAQs from Google Sheets, or returns mock data.
   */
  public static async getClinicInfo(
    tabName: 'Clinic_Metadata' | 'Services_Config' | 'Doctors_Config', 
    spreadsheetId?: string
  ): Promise<any[]> {
    if (this.isMockMode) {
      throw new Error('Google Sheets API is running in mock mode due to missing credentials.');
    }

    try {
      const auth = await GoogleService.getAuthClient();
      const sheetId = spreadsheetId || config.google.spreadsheetId;
      const response = await this.sheets.spreadsheets.values.get({
        auth,
        spreadsheetId: sheetId,
        range: `${tabName}!A2:J100` // Assumes headers on row 1 (columns A to J)
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) return [];

      if (tabName === 'Clinic_Metadata') {
        return rows.map(r => ({
          branch: r[0],
          address: r[1],
          workingHours: r[2],
          phone: r[3],
          calendarId: r[4],
          doctors: r[5] ? r[5].split(/,|\n|\r\n/).map((s: string) => s.trim()).filter((s: string) => s.length > 0) : []
        }));
      } else if (tabName === 'Doctors_Config') {
        return rows.map(r => ({
          doctorName: r[0],
          branch: r[1],
          workingHours: r[2],
          secretariatPhone: r[3],
          specialization: r[4],
          workingDays: r[5],
          offDays: r[6],
          breakTimes: r[7],
          dailyPatientCapacity: r[8] ? parseInt(r[8], 10) : 0,
          doctorTitleExperience: r[9] || ''
        }));
      } else {
        return rows.map(r => ({
          name: r[0],
          type: r[1],
          price: r[2],
          doctor: r[3] || 'لا يوجد',
          duration: parseInt(r[4] || '30', 10),
          offer: r[5] || 'لا يوجد',
          preInstructions: r[6] || ''
        }));
      }
    } catch (error: any) {
      console.error(`❌ Error fetching ${tabName} from Google Sheets:`, error.message);
      throw error;
    }
  }

  /**
   * Logs a finalized patient booking in Google Sheets, or mock database.
   * Ensures phone numbers are unified to 11 digits starting with 07.
   * Generates a sequential Booking ID in the AAA1 -> AAA999 -> AAB1 format.
   */
  public static async logPatientBooking(booking: BookingData, spreadsheetId?: string): Promise<boolean> {
    // Generate next sequential booking ID
    let nextId = 'AAA1';
    const sheetId = spreadsheetId || config.google.spreadsheetId;

    if (!this.isMockMode) {
      try {
        const auth = await GoogleService.getAuthClient();
        const response = await this.sheets.spreadsheets.values.get({
          auth,
          spreadsheetId: sheetId,
          range: 'Bookings!A2:A1000'
        });

        const rows = response.data.values || [];
        if (rows.length > 0) {
          const lastRow = rows[rows.length - 1];
          const lastId = lastRow ? lastRow[0] : '';
          if (lastId) {
            nextId = this.incrementBookingId(lastId);
          }
        }
      } catch (err: any) {
        console.error('⚠️ Failed to fetch last booking ID, using fallback AAA1:', err.message);
      }
    } else {
      if (mockBookings.length > 0) {
        const lastMock = mockBookings[mockBookings.length - 1];
        if (lastMock.bookingId) {
          nextId = this.incrementBookingId(lastMock.bookingId);
        }
      }
    }

    booking.bookingId = nextId;

    // Unify phone format (ensure it's 11 digits starting with 07)
    let unifiedPhone = booking.phoneNumber.trim().replace(/\D/g, '');
    if (!unifiedPhone.startsWith('0')) {
      unifiedPhone = '0' + unifiedPhone;
    }
    const bookingWithId = { ...booking, bookingId: nextId, phoneNumber: unifiedPhone };

    if (this.isMockMode) {
      mockBookings.push(bookingWithId);
      console.log('📝 [MOCK] Logged booking to database:', bookingWithId);
      return true;
    }

    try {
      const auth = await GoogleService.getAuthClient();
      const values = [[
        nextId,
        bookingWithId.patientName,
        bookingWithId.phoneNumber,
        bookingWithId.branch,
        bookingWithId.serviceName,
        GoogleService.toHumanReadableDateTime(bookingWithId.bookingDatetime),
        bookingWithId.durationMinutes.toString(),
        bookingWithId.status,
        bookingWithId.notes || '',
        bookingWithId.doctorName || 'أي طبيب متوفر'
      ]];

      await this.sheets.spreadsheets.values.append({
        auth,
        spreadsheetId: sheetId,
        range: 'Bookings!A:J',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values }
      });

      console.log(`✅ Booking logged to Google Sheets successfully with ID: ${nextId}`);
      return true;
    } catch (error: any) {
      console.error('❌ Error logging booking to Google Sheets:', error.message);
      return false;
    }
  }

  /**
   * Checks if a phone number has 2 or more 'No-Show' entries in the Bookings sheet.
   */
  public static async isPhoneNumberBlocked(phone: string, spreadsheetId?: string): Promise<boolean> {
    if (this.isMockMode) {
      return false;
    }

    try {
      const auth = await GoogleService.getAuthClient();
      const sheetId = spreadsheetId || config.google.spreadsheetId;

      const response = await this.sheets.spreadsheets.values.get({
        auth,
        spreadsheetId: sheetId,
        range: 'Bookings!A2:J1000'
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return false;
      }

      const cleanPhone = (p: string) => p.replace(/\D/g, '').slice(-9);
      const targetPhoneClean = cleanPhone(phone);

      let noShowCount = 0;
      for (const row of rows) {
        const rowPhone = row[2] || '';
        const rowStatus = row[7] || ''; // Column H (index 7) is status

        if (cleanPhone(rowPhone) === targetPhoneClean && rowStatus.trim().toLowerCase() === 'no-show') {
          noShowCount++;
          if (noShowCount >= 2) {
            console.warn(`🚫 Phone number ${phone} is blocked due to ${noShowCount} No-Shows.`);
            return true;
          }
        }
      }

      return false;
    } catch (error: any) {
      console.error('❌ Error checking block status:', error.message);
      return false;
    }
  }

  /**
   * Adds a user to the Waitlist sheet.
   */
  public static async addToWaitlist(
    patientName: string,
    phoneNumber: string,
    branch: string,
    serviceName: string,
    preferredDate: string,
    doctorName?: string,
    spreadsheetId?: string
  ): Promise<boolean> {
    if (this.isMockMode) {
      console.log(`📅 [MOCK] Added ${patientName} to waitlist for ${preferredDate}`);
      return true;
    }

    try {
      const auth = await GoogleService.getAuthClient();
      const sheetId = spreadsheetId || config.google.spreadsheetId;

      // Ensure Waitlist tab exists
      await this.ensureWaitlistTabExists(sheetId, auth);

      const timestamp = GoogleService.toHumanReadableDateTime(new Date().toISOString());
      const values = [[
        timestamp,
        patientName,
        phoneNumber,
        branch,
        serviceName,
        preferredDate,
        doctorName || 'أي طبيب متوفر',
        'Pending' // Status of waitlist entry
      ]];

      await this.sheets.spreadsheets.values.append({
        auth,
        spreadsheetId: sheetId,
        range: 'Waitlist!A:H',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values }
      });

      console.log(`✅ Patient ${patientName} added to Waitlist successfully.`);
      return true;
    } catch (error: any) {
      console.error('❌ Error adding to waitlist:', error.message);
      return false;
    }
  }

  /**
   * Helper to ensure the 'Waitlist' tab exists. If not, creates it with headers.
   */
  private static async ensureWaitlistTabExists(spreadsheetId: string, auth: any): Promise<void> {
    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        auth,
        spreadsheetId
      });

      const sheetsList = spreadsheet.data.sheets || [];
      const hasWaitlist = sheetsList.some(s => s.properties?.title === 'Waitlist');

      if (!hasWaitlist) {
        console.log('📊 Waitlist tab not found. Creating it...');
        await this.sheets.spreadsheets.batchUpdate({
          auth,
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: 'Waitlist'
                  }
                }
              }
            ]
          }
        });

        // Add headers
        const headers = [['AddedAt', 'PatientName', 'PhoneNumber', 'Branch', 'ServiceName', 'PreferredDate', 'DoctorName', 'WaitlistStatus']];
        await this.sheets.spreadsheets.values.update({
          auth,
          spreadsheetId,
          range: 'Waitlist!A1:H1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: headers }
        });
        console.log('✅ Created Waitlist tab and wrote headers.');
      }
    } catch (err: any) {
      console.error('❌ Failed to ensure Waitlist tab exists:', err.message);
      throw err;
    }
  }

  /**
   * Reschedules/modifies an existing booking in both Google Sheets and Google Calendar.
   */
  public static async modifyBooking(
    patientName: string,
    phone: string,
    oldDatetimeStr: string,
    newDatetimeStr: string,
    branch: string,
    newDurationMinutes?: number,
    newDoctorName?: string,
    spreadsheetId?: string
  ): Promise<boolean> {
    if (this.isMockMode) {
      console.log(`📅 [MOCK] Rescheduled booking for ${patientName} from ${oldDatetimeStr} to ${newDatetimeStr}`);
      return true;
    }

    try {
      const auth = await GoogleService.getAuthClient();
      const sheetId = spreadsheetId || config.google.spreadsheetId;

      // Step 1: Find and update the row in Google Sheets
      const response = await this.sheets.spreadsheets.values.get({
        auth,
        spreadsheetId: sheetId,
        range: 'Bookings!A2:J1000'
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        console.error('❌ No bookings found in Sheets to modify.');
        return false;
      }

      // Clean phone numbers for comparison (match last 9 digits)
      const cleanPhone = (p: string) => p.replace(/\D/g, '').slice(-9);
      const targetPhoneClean = cleanPhone(phone);

      const oldDate = new Date(oldDatetimeStr);
      const normalizedPatientName = this.normalizeArabicText(patientName);

      let matchedRowIndex = -1;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowPatientName = this.normalizeArabicText(row[1] || '');
        const rowPhone = row[2] || '';
        const rowDatetime = row[5] || '';

        const nameMatch = rowPatientName.includes(normalizedPatientName) || normalizedPatientName.includes(rowPatientName);
        const phoneMatch = cleanPhone(rowPhone) === targetPhoneClean;
        
        let dateMatch = false;
        try {
          // If the date string in sheets doesn't specify timezone, append +03:00
          const finalDateStr = (rowDatetime.includes('AM') || rowDatetime.includes('PM')) && !rowDatetime.includes('+')
            ? `${rowDatetime} +03:00`
            : rowDatetime;
          dateMatch = new Date(finalDateStr).toDateString() === oldDate.toDateString();
        } catch {}

        if (nameMatch && phoneMatch && dateMatch) {
          matchedRowIndex = i;
          break;
        }
      }

      if (matchedRowIndex === -1) {
        console.error(`❌ Booking not found in Sheets for patient ${patientName} on ${oldDatetimeStr}.`);
        return false;
      }

      const rowIndex = matchedRowIndex + 2; // Convert to 1-based sheet row index

      // Update date/time in column F (index 5)
      await this.sheets.spreadsheets.values.update({
        auth,
        spreadsheetId: sheetId,
        range: `Bookings!F${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[GoogleService.toHumanReadableDateTime(newDatetimeStr)]] }
      });

      // Update doctor in column J (index 9) if provided
      if (newDoctorName) {
        await this.sheets.spreadsheets.values.update({
          auth,
          spreadsheetId: sheetId,
          range: `Bookings!J${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[newDoctorName]] }
        });
      }

      console.log(`✅ Google Sheet row ${rowIndex} updated successfully.`);

      // Step 2: Find and update the event in Google Calendar
      const metadata = await this.getClinicInfo('Clinic_Metadata', spreadsheetId);
      const branchInfo = metadata.find(m => m.branch.includes(branch) || branch.includes(m.branch));

      if (!branchInfo) {
        console.error(`❌ Branch not found: ${branch}`);
        return false;
      }

      const calendarIds = branchInfo.calendarId
        ? branchInfo.calendarId.split(/,|\n|\r\n/).map((s: string) => s.trim()).filter((s: string) => s.length > 0)
        : [];

      if (calendarIds.length === 0) {
        console.error(`❌ No calendar IDs configured for branch: ${branch}`);
        return false;
      }

      let eventToUpdate: any = null;
      let targetCalendarId = '';

      const timeMin = new Date(oldDate.getTime() - 2 * 60 * 60 * 1000).toISOString(); // Look +/- 2 hours
      const timeMax = new Date(oldDate.getTime() + 2 * 60 * 60 * 1000).toISOString();

      for (const calId of calendarIds) {
        try {
          const eventsRes = await this.calendar.events.list({
            auth,
            calendarId: calId,
            timeMin,
            timeMax,
            singleEvents: true
          });

          const events = eventsRes.data.items || [];
          const matchedEvent = events.find(e => this.normalizeArabicText(e.summary || '').includes(normalizedPatientName));

          if (matchedEvent) {
            eventToUpdate = matchedEvent;
            targetCalendarId = calId;
            break;
          }
        } catch (calErr: any) {
          console.error(`⚠️ Failed to list events on calendar ${calId}:`, calErr.message);
        }
      }

      if (eventToUpdate && targetCalendarId) {
        const start = new Date(newDatetimeStr);
        const duration = newDurationMinutes || parseInt(rows[matchedRowIndex][6] || '30', 10);
        const end = new Date(start.getTime() + duration * 60 * 1000);

        const startStr = GoogleService.toBaghdadISOString(start);
        const endStr = GoogleService.toBaghdadISOString(end);

        eventToUpdate.start = { dateTime: startStr, timeZone: 'Asia/Baghdad' };
        eventToUpdate.end = { dateTime: endStr, timeZone: 'Asia/Baghdad' };
        
        if (newDoctorName) {
          eventToUpdate.description = eventToUpdate.description?.replace(/الطبيب: .*/, `الطبيب: ${newDoctorName}`) || `الطبيب: ${newDoctorName}`;
        }

        console.log(`📅 Updating Google Calendar event ${eventToUpdate.id} in calendar: ${targetCalendarId}...`);
        await this.calendar.events.update({
          auth,
          calendarId: targetCalendarId,
          eventId: eventToUpdate.id,
          requestBody: eventToUpdate
        });

        console.log('✅ Google Calendar Event rescheduled successfully.');
      } else {
        console.warn(`⚠️ Matching Google Calendar event not found for patient ${patientName} on ${oldDatetimeStr}. Event time not updated.`);
      }

      return true;
    } catch (error: any) {
      console.error('❌ Failed to reschedule booking:', error.message);
      return false;
    }
  }

  /**
   * Checks branch availability for a date/duration against Google Calendar.
   * Supports multiple calendars per branch (union of free slots).
   */
  public static async checkCalendarAvailability(
    branchName: string,
    dateStr: string,
    durationMinutes: number,
    spreadsheetId?: string,
    doctorName?: string
  ): Promise<string[]> {
    if (this.isMockMode) {
      return ['15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30'];
    }

    try {
      const auth = await GoogleService.getAuthClient();
      const metadata = await this.getClinicInfo('Clinic_Metadata', spreadsheetId);
      const branchInfo = metadata.find(m => m.branch.includes(branchName) || branchName.includes(m.branch));

      if (!branchInfo) {
        console.warn(`⚠️ Branch not found: ${branchName}.`);
        return ['15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
      }

      // Parse calendar IDs (comma or newline separated)
      const calendarIds = branchInfo.calendarId
        ? branchInfo.calendarId.split(/,|\n|\r\n/).map((s: string) => s.trim()).filter((s: string) => s.length > 0)
        : [];

      if (calendarIds.length === 0) {
        console.warn(`⚠️ Calendar IDs not found for branch: ${branchName}.`);
        return ['15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
      }

      // Determine which calendars to check (match preferred doctor if specified)
      let targetCalendarIds = calendarIds;
      if (doctorName && branchInfo.doctors && branchInfo.doctors.length > 0) {
        const docIndex = branchInfo.doctors.findIndex((d: string) => d.includes(doctorName) || doctorName.includes(d));
        if (docIndex !== -1 && calendarIds[docIndex]) {
          targetCalendarIds = [calendarIds[docIndex]];
        }
      }

      const workingHoursStr = branchInfo.workingHours || '03:00 PM - 09:00 PM';
      const timeRange = this.parseWorkingHours(workingHoursStr);
      const timeMin = `${dateStr}T${timeRange.start}:00+03:00`;
      const timeMax = `${dateStr}T${timeRange.end}:00+03:00`;

      // Collect available slots from all target calendars (union of free slots)
      const allAvailableSlotsSet = new Set<string>();

      for (const calId of targetCalendarIds) {
        try {
          console.log(`📅 Querying Google Calendar events for calendar: ${calId} on ${dateStr}...`);
          const eventsResponse = await this.calendar.events.list({
            auth,
            calendarId: calId,
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: 'startTime'
          });

          const events = eventsResponse.data.items || [];
          const busySlots = events.map(e => ({
            start: new Date(e.start?.dateTime || e.start?.date || ''),
            end: new Date(e.end?.dateTime || e.end?.date || '')
          }));

          const startDateTime = new Date(`${dateStr}T${timeRange.start}:00+03:00`);
          const endDateTime = new Date(`${dateStr}T${timeRange.end}:00+03:00`);

          let current = new Date(startDateTime);
          while (current.getTime() + durationMinutes * 60 * 1000 <= endDateTime.getTime()) {
            const slotStart = new Date(current);
            const slotEnd = new Date(current.getTime() + durationMinutes * 60 * 1000);

            const isBusy = busySlots.some(busy => slotStart < busy.end && slotEnd > busy.start);

            if (!isBusy) {
              const hh = String(slotStart.getHours()).padStart(2, '0');
              const mm = String(slotStart.getMinutes()).padStart(2, '0');
              allAvailableSlotsSet.add(`${hh}:${mm}`);
            }

            current.setMinutes(current.getMinutes() + 30);
          }
        } catch (calErr: any) {
          console.error(`❌ Failed to query calendar ${calId}:`, calErr.message);
        }
      }

      const sortedSlots = Array.from(allAvailableSlotsSet).sort();
      console.log(`✅ Total available slots across queried calendars: ${sortedSlots.length}`);
      
      return sortedSlots.length > 0 ? sortedSlots : ['15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
    } catch (error: any) {
      console.error('❌ Google Calendar check failed:', error.message);
      return ['15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
    }
  }

  /**
   * Helper to parse working hours string into start/end 24h formats.
   */
  private static parseWorkingHours(hoursStr: string): { start: string; end: string } {
    try {
      const cleaned = hoursStr.replace(/\s+/g, '').toUpperCase();
      const parts = cleaned.split('-');
      if (parts.length !== 2) return { start: '15:00', end: '21:00' };

      const parseTime = (t: string) => {
        const isPM = t.includes('PM');
        const isAM = t.includes('AM');
        const cleanTime = t.replace('PM', '').replace('AM', '');
        const timeParts = cleanTime.split(':');
        let hours = parseInt(timeParts[0], 10);
        const minutes = timeParts[1] || '00';

        if (isPM && hours !== 12) hours += 12;
        if (isAM && hours === 12) hours = 0;

        return `${String(hours).padStart(2, '0')}:${minutes}`;
      };

      return {
        start: parseTime(parts[0]),
        end: parseTime(parts[1])
      };
    } catch {
      return { start: '15:00', end: '21:00' };
    }
  }

  /**
   * Creates a Google Calendar event for a confirmed booking.
   * Directs to the specific doctor's calendar if configured.
   * Includes a direct WhatsApp chat link for the clinic staff.
   */
  public static async createCalendarEvent(booking: BookingData, spreadsheetId?: string): Promise<boolean> {
    if (this.isMockMode) {
      console.log('📅 [MOCK] Created Google Calendar event:', booking);
      return true;
    }

    try {
      const auth = await GoogleService.getAuthClient();
      const metadata = await this.getClinicInfo('Clinic_Metadata', spreadsheetId);
      const branchInfo = metadata.find(m => m.branch.includes(booking.branch) || booking.branch.includes(m.branch));

      if (!branchInfo) {
        console.error(`❌ Branch not found: ${booking.branch}`);
        return false;
      }

      const calendarIds = branchInfo.calendarId
        ? branchInfo.calendarId.split(/,|\n|\r\n/).map((s: string) => s.trim()).filter((s: string) => s.length > 0)
        : [];

      if (calendarIds.length === 0) {
        console.error(`❌ No calendar IDs configured for branch: ${booking.branch}`);
        return false;
      }

      // Determine which calendar to insert the event into
      let targetCalendarId = calendarIds[0];
      if (booking.doctorName && branchInfo.doctors && branchInfo.doctors.length > 0) {
        const docIndex = branchInfo.doctors.findIndex((d: string) => d.includes(booking.doctorName!) || booking.doctorName!.includes(d));
        if (docIndex !== -1 && calendarIds[docIndex]) {
          targetCalendarId = calendarIds[docIndex];
        }
      }

      // Unify and build WhatsApp Link
      const cleanPhoneDigits = booking.phoneNumber.replace(/\D/g, '');
      const waNumber = cleanPhoneDigits.startsWith('0') 
        ? '964' + cleanPhoneDigits.substring(1) 
        : cleanPhoneDigits.startsWith('964') 
          ? cleanPhoneDigits 
          : '964' + cleanPhoneDigits;
      const waLink = `https://wa.me/${waNumber}`;

      const start = new Date(booking.bookingDatetime);
      const end = new Date(start.getTime() + booking.durationMinutes * 60 * 1000);

      // Convert explicitly to Baghdad timezone string format without trailing Z
      const startStr = GoogleService.toBaghdadISOString(start);
      const endStr = GoogleService.toBaghdadISOString(end);

      const event = {
        summary: `حجز: ${booking.patientName}`,
        description: `معرّف الحجز: ${booking.bookingId}\nالإجراء: ${booking.serviceName}\nالهاتف: ${booking.phoneNumber}\nرابط واتساب: ${waLink}\nالطبيب: ${booking.doctorName || 'أي طبيب متوفر'}\nملاحظات: ${booking.notes || ''}`,
        start: { dateTime: startStr, timeZone: 'Asia/Baghdad' },
        end: { dateTime: endStr, timeZone: 'Asia/Baghdad' }
      };

      console.log(`📅 Inserting calendar event into calendar: ${targetCalendarId} at ${startStr}...`);
      await this.calendar.events.insert({
        auth,
        calendarId: targetCalendarId,
        requestBody: event
      });

      console.log('✅ Google Calendar Event created successfully.');
      return true;
    } catch (error: any) {
      console.error('❌ Failed to insert Google Calendar event:', error.message);
      return false;
    }
  }
}
