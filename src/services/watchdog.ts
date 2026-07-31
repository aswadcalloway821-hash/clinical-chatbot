import { PatientSession, TenantConfig } from '../types/booking.js';

export class WatchdogService {
  private static sessions: Map<string, PatientSession> = new Map();
  private static callbackSendWhatsApp: ((phone: string, text: string) => Promise<void>) | null = null;

  public static registerSendCallback(cb: (phone: string, text: string) => Promise<void>) {
    this.callbackSendWhatsApp = cb;
  }

  /**
   * Monitor sessions and execute Revenue Recovery on abandoned interactions
   */
  public static startMonitoring(sessionsStore: Map<string, PatientSession>, tenant: TenantConfig) {
    this.sessions = sessionsStore;

    // Run watchdog scan every 2 minutes
    setInterval(async () => {
      const now = Date.now();
      const INACTIVITY_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

      for (const [phone, session] of this.sessions.entries()) {
        if (
          session.currentState !== 'CONFIRMED' &&
          session.currentState !== 'HUMAN_HANDOFF' &&
          session.lastInteractionTime > 0 &&
          now - session.lastInteractionTime > INACTIVITY_THRESHOLD_MS
        ) {
          // Send polite Iraqi Follow-up message
          const recoveryMessage = `يا هلا بيك عيني أستاذي، شفت حجزك بمركز ${tenant.clinicName} بعده ما مكتمل. تحب نكمل اختيار الموعد المناسب إلك؟ أنا بخدمتك بلي تحتاجه.`;

          console.log(`[Watchdog & Revenue Recovery] Follow-up sent to inactive patient: ${phone}`);

          if (this.callbackSendWhatsApp) {
            await this.callbackSendWhatsApp(phone, recoveryMessage);
          }

          // Reset interaction time to avoid spamming
          session.lastInteractionTime = 0;
        }
      }
    }, 120000);
  }
}
