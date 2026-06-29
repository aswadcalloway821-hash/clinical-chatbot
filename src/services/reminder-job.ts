import fs from 'fs';
import path from 'path';
import { TenantManager } from '../config/tenant-manager';
import { GoogleService } from './google.service';
import { WhatsappService } from './whatsapp.service';
import { google } from 'googleapis';
import { config } from '../config';

export class ReminderJob {
  private static sentRemindersPath = path.join(process.cwd(), 'sent_reminders.json');
  private static intervalId: NodeJS.Timeout | null = null;
  private static calendar = google.calendar('v3');

  /**
   * Starts the silent background reminder scheduler.
   * Runs the check immediately, then runs every 30 minutes.
   */
  public static start(): void {
    if (this.intervalId) {
      console.warn('⚠️ ReminderJob scheduler is already running.');
      return;
    }

    console.log('⏰ Starting Automated WhatsApp Reminder Job...');
    this.checkAndSendReminders();

    // Run every 30 minutes (30 * 60 * 1000 ms)
    this.intervalId = setInterval(() => {
      this.checkAndSendReminders();
    }, 30 * 60 * 1000);
  }

  /**
   * Stops the background scheduler
   */
  public static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('⏰ Stopped Automated WhatsApp Reminder Job.');
    }
  }

  /**
   * Main job function to scan calendars and send reminders
   */
  private static async checkAndSendReminders(): Promise<void> {
    try {
      console.log('⏰ Running reminder scan...');
      const tenants = TenantManager.getAllTenants();
      const sentList = this.loadSentList();

      for (const phoneId in tenants) {
        const tenant = tenants[phoneId];
        const spreadsheetId = tenant.spreadsheetId;
        const apiToken = tenant.apiToken;

        // Fetch branches for this tenant
        const branches = await GoogleService.getClinicInfo('Clinic_Metadata', spreadsheetId);

        for (const branch of branches) {
          if (!branch.calendarId || branch.calendarId.startsWith('mock_cal')) {
            // Skip mock calendars
            continue;
          }

          await this.scanBranchCalendar(branch, tenant, phoneId, apiToken, sentList);
        }
      }

      this.saveSentList(sentList);
    } catch (error: any) {
      console.error('❌ Error running reminder job:', error.message);
    }
  }

  private static async scanBranchCalendar(
    branch: any,
    tenant: any,
    phoneId: string,
    apiToken: string,
    sentList: string[]
  ): Promise<void> {
    try {
      // Initialize Auth Client (we reuse the static GoogleAuth client from GoogleService if available)
      const authClient = await GoogleService.getAuthClient();
      if (!authClient) {
        console.warn('⚠️ Google Auth not initialized. Skipping reminder scan for Calendar.');
        return;
      }
      const now = new Date();

      // Query events from now to now + 3 hours
      const timeMin = now.toISOString();
      const timeMax = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();

      const response = await this.calendar.events.list({
        auth: authClient,
        calendarId: branch.calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = response.data.items || [];

      for (const event of events) {
        if (event.status === 'cancelled' || !event.start?.dateTime || !event.id) {
          continue;
        }

        const eventId = event.id;
        const startTime = new Date(event.start.dateTime);
        const diffMs = startTime.getTime() - now.getTime();
        const diffMinutes = diffMs / (60 * 1000);

        // Fetch configured reminder hours dynamically, defaulting to 2 hours
        const reminderHours = tenant.reminderHoursBefore !== undefined ? tenant.reminderHoursBefore : 2;
        const targetDiffMinutes = reminderHours * 60;

        // Target appointments starting in roughly [target - 30] to [target + 30] minutes
        if (diffMinutes >= (targetDiffMinutes - 30) && diffMinutes <= (targetDiffMinutes + 30)) {
          if (sentList.includes(eventId)) {
            // Already sent
            continue;
          }

          // Parse patient info from description
          // Format logged: "المراجع: علي\nالهاتف: 9647700000000\nالطبيب: د. سارة\nملاحظات: ..."
          const description = event.description || '';
          const phoneMatch = description.match(/الهاتف:\s*(\+?\d+)/i);
          const nameMatch = description.match(/المراجع:\s*([^\n]+)/i);

          if (phoneMatch) {
            const patientPhone = phoneMatch[1].trim();
            const patientName = nameMatch ? nameMatch[1].trim() : 'عيوني';
            
            // Format Iraq local time for reminder message
            const timeStr = startTime.toLocaleTimeString('en-US', {
              timeZone: 'Asia/Baghdad',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            });

            const messageText = `عيني أستاذ/ست ${patientName}، نذكرك بموعد حجزك اليوم الساعة ${timeStr} في عيادتنا (${tenant.clinicName}). ننتظرك بكل حب! 🌸`;

            console.log(`⏰ Sending auto-reminder to ${patientPhone} for appointment at ${timeStr}...`);
            const success = await WhatsappService.sendTextMessage(patientPhone, messageText, apiToken, phoneId);
            
            if (success) {
              sentList.push(eventId);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`❌ Error scanning calendar ${branch.calendarId} for reminders:`, err.message);
    }
  }

  private static loadSentList(): string[] {
    try {
      if (fs.existsSync(this.sentRemindersPath)) {
        const fileContent = fs.readFileSync(this.sentRemindersPath, 'utf8');
        return JSON.parse(fileContent);
      }
    } catch (e: any) {
      console.error('❌ Error reading sent_reminders.json:', e.message);
    }
    return [];
  }

  private static saveSentList(list: string[]): void {
    try {
      // Keep only last 1000 items to prevent the file from growing indefinitely
      const prunedList = list.slice(-1000);
      fs.writeFileSync(this.sentRemindersPath, JSON.stringify(prunedList, null, 2), 'utf8');
    } catch (e: any) {
      console.error('❌ Error saving sent_reminders.json:', e.message);
    }
  }
}
