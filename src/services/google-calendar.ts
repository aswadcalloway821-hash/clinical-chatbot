import { google } from 'googleapis';
import fs from 'fs';
import { Booking, Doctor } from '../types/booking.js';

export class GoogleCalendarService {
  /**
   * Fetch Access Token dynamically from Service Account (Env Var GOOGLE_SERVICE_ACCOUNT_JSON / google-creds.json)
   * OAuth2 refresh tokens are completely eliminated for strict enterprise security.
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
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/spreadsheets'
          ]
        });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        if (tokenResponse.token) return tokenResponse.token;
      }
    } catch (envErr) {
      console.warn('[Calendar Env Service Account Auth Warning]:', envErr);
    }

    // 2. Try local file google-creds.json (for local development)
    try {
      const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'google-creds.json';
      if (fs.existsSync(credsPath)) {
        const auth = new google.auth.GoogleAuth({
          keyFile: credsPath,
          scopes: [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/spreadsheets'
          ]
        });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        if (tokenResponse.token) return tokenResponse.token;
      }
    } catch (saErr) {
      console.warn('[Calendar File Service Account Auth Warning]:', saErr);
    }

    return null;
  }

  /**
   * Sync confirmed booking directly into doctor's Google Calendar via Google Calendar REST API v3
   */
  public static async syncAppointment(booking: Booking, doctor: Doctor): Promise<string | null> {
    try {
      const token = await this.getAccessToken();
      if (!token) return null;

      const calendarId = doctor.calendarId || 'primary';
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

      // Wall-clock time WITHOUT offset + explicit timeZone (correct format for Calendar API v3)
      const startDateTime = `${booking.date}T${booking.startTime}:00`;
      const endDateTime = `${booking.date}T${booking.endTime}:00`;

      const event = {
        summary: `حجز طبي: ${booking.patientName} (${booking.bookingCode})`,
        description: `خدمة: ${booking.serviceName}\nمريض: ${booking.patientName}\nهاتف: ${booking.patientPhone}\nفرع: ${booking.branchName}\nكود الحجز: ${booking.bookingCode}`,
        start: { dateTime: startDateTime, timeZone: 'Asia/Baghdad' },
        end: { dateTime: endDateTime, timeZone: 'Asia/Baghdad' }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      });

      if (res.ok) {
        const data = await res.json() as any;
        console.log(`[Google Calendar API] Synced appointment for ${booking.patientName} -> Event ID: ${data.id}`);
        return data.id || null;
      } else {
        console.warn(`[Google Calendar API Warning]: HTTP ${res.status}`);
        return null;
      }
    } catch (err) {
      console.warn('[Google Calendar API Exception]:', err);
      return null;
    }
  }

  /**
   * Cancel event in Google Calendar
   */
  public static async cancelAppointment(calendarId: string, eventId: string): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      if (!token || !eventId) return false;

      const calId = calendarId || 'primary';
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`;

      const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      return res.ok;
    } catch {
      return false;
    }
  }
}
