export class GoogleCalendarService {
    /**
     * Fetch Access Token dynamically from Google OAuth2 Refresh Token
     */
    static async getAccessToken() {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
        if (!clientId || !clientSecret || !refreshToken)
            return null;
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
            const data = await res.json();
            return data.access_token || null;
        }
        catch {
            return null;
        }
    }
    /**
     * Sync confirmed booking directly into doctor's Google Calendar via Google Calendar REST API v3
     */
    static async syncAppointment(booking, doctor) {
        try {
            const token = await this.getAccessToken();
            if (!token)
                return null;
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
            const data = await res.json();
            if (res.ok) {
                console.log(`[Google Calendar REST API] Synced event: ${data.id}`);
                return data.id || null;
            }
            return null;
        }
        catch (error) {
            console.warn('[Google Calendar Sync Warning]:', error);
            return null;
        }
    }
}
//# sourceMappingURL=google-calendar.js.map