import { GoogleSheetsService } from './google-sheets.js';

export class ReminderJob {
  private static isRunning = false;

  /**
   * Main execution check for sending 4-hour pre-appointment reminders
   */
  public static async checkAndSendReminders(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const tenant = await GoogleSheetsService.getTenantConfig();
      const rows = await (GoogleSheetsService as any).fetchSheetValues('Bookings!A1:Z500');
      if (!rows || rows.length < 2) {
        this.isRunning = false;
        return;
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const now = new Date();

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const bookingCode = r[0] || '';
        const patientName = r[1] || 'مراجع كريم';
        const phone = r[2] || '';
        const branchName = r[3] || tenant.branches[0]?.name || '';
        const dateTimeStr = r[5] || ''; // e.g. "2026-08-01 16:00"
        const status = (r[7] || '').toUpperCase();
        const reminderStatus = (r[10] || '').toUpperCase(); // Column K

        if (status === 'CONFIRMED' && reminderStatus !== 'SENT' && dateTimeStr.includes(todayStr)) {
          const timePart = dateTimeStr.split(' ')[1] || '16:00';
          const [hours, minutes] = timePart.split(':').map(Number);

          const appointmentDate = new Date();
          appointmentDate.setHours(hours || 16, minutes || 0, 0, 0);

          const diffMs = appointmentDate.getTime() - now.getTime();
          const diffHours = diffMs / (1000 * 60 * 60);

          // Trigger reminder if appointment is between 3.5 and 4.5 hours away
          if (diffHours >= 3.5 && diffHours <= 4.5) {
            const reminderMessage = 
`مرحباً أستاذ/ست ${patientName} 🌸
نحب نذكرك بموعدك اليوم الساعة ${timePart} بـ ${tenant.clinicName} (${branchName}).
ننتظرك تنورنا بالعيادة!
اذا عندك أي ظرف وحبّيت نغير بلحجز او نلغي تدلل وماكو أي إشكال,  بس بلغنا وأنا بخدمتك.`;

            console.log(`[Scheduled Reminder Job] Sending 4-hour pre-appointment reminder to ${patientName} (${phone}) for booking ${bookingCode}`);
            
            // Mark reminder status as SENT in Google Sheets to prevent duplicate sending
            await GoogleSheetsService.updateReminderStatus(bookingCode, 'SENT');
          }
        }
      }
    } catch (err) {
      console.warn('[Scheduled Reminder Job Warning]:', err);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the background scheduler running every 15 minutes
   */
  public static startScheduler(intervalMs: number = 15 * 60 * 1000): void {
    console.log(`[Scheduled Reminder Job] Initializing background reminder scheduler (every ${intervalMs / 60000} minutes)...`);
    this.checkAndSendReminders();
    setInterval(() => {
      this.checkAndSendReminders();
    }, intervalMs);
  }
}
