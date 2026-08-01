import { Booking, Doctor } from '../types/booking.js';

export class GoogleCalendarService {
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
   * Sync confirmed booking directly into doctor's Google Calendar via Google Calendar REST API v3
   */
  public static async syncAppointment(booking: Booking, doctor: Doctor): Promise<string | null> {
    try {
      const token = await this.getAccessToken();
      if (!token) return null;

      const calendarId = doctor.calendarId || 'primary';
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

      const startDateTime = `${booking.date}T${booking.startTime}:00+03:00`;
      const endDateTime = `${booking.date}T${booking.endTime}:00+03:00`;

      const event = {
        summary: `حجز طبي: ${booking.patientName} (${booking.bookingCode})`,
        description: `خدمة: ${booking.serviceName}\nمريض: ${booking.patientName}\nهاتف: ${booking.patientPhone}\nفرع: ${booking.branchName}`,
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
