import { google } from 'googleapis';
import { Booking, Doctor } from '../types/booking.js';

export class GoogleCalendarService {
  private static auth: any = null;

  private static getAuthClient() {
    if (!this.auth) {
      try {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

        if (clientId && clientSecret && refreshToken) {
          const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
          oauth2Client.setCredentials({ refresh_token: refreshToken });
          this.auth = oauth2Client;
        } else {
          const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || './google-creds.json';
          this.auth = new google.auth.GoogleAuth({
            keyFile,
            scopes: ['https://www.googleapis.com/auth/calendar']
          });
        }
      } catch (err) {
        console.warn('Google Calendar Credentials not provided yet.');
      }
    }
    return this.auth;
  }

  /**
   * Sync confirmed booking directly into doctor's Google Calendar
   */
  public static async syncAppointment(booking: Booking, doctor: Doctor): Promise<string | null> {
    try {
      const auth = this.getAuthClient();
      if (!auth) return null;

      const calendar = google.calendar({ version: 'v3', auth });
      const calendarId = doctor.calendarId || 'primary';

      const startDateTime = `${booking.date}T${booking.startTime}:00+03:00`; // Baghdad Time (GMT+3)
      const endDateTime = `${booking.date}T${booking.endTime}:00+03:00`;

      const event = {
        summary: `حجز طبي: ${booking.patientName} (${booking.bookingCode})`,
        description: `خدمة: ${booking.serviceName}\nمريض: ${booking.patientName}\nهاتف: ${booking.patientPhone}\nفرع: ${booking.branchName}`,
        start: { dateTime: startDateTime, timeZone: 'Asia/Baghdad' },
        end: { dateTime: endDateTime, timeZone: 'Asia/Baghdad' }
      };

      const res = await calendar.events.insert({
        calendarId,
        requestBody: event
      });

      console.log(`[Google Calendar] Event synced: ${res.data.id}`);
      return res.data.id || null;
    } catch (error) {
      console.warn('[Google Calendar Sync Warning]: Offline mode or credentials pending.');
      return null;
    }
  }
}
