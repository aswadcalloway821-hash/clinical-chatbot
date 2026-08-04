import { PatientSession, TenantConfig } from '../types/booking.js';

export class HandoffManager {
  /**
   * Check if session should trigger Human Handoff
   */
  public static shouldTriggerHandoff(
    session: PatientSession,
    intent: string,
    confidence: number
  ): boolean {
    // 1. Explicit request for human
    if (intent === 'REQUEST_HUMAN' || intent === 'ANGRY_EXPRESSION') {
      return true;
    }

    // 2. Low confidence / failed NLU attempts >= 3
    if (session.failedNluAttempts >= 3 || confidence < 0.3) {
      return true;
    }

    return false;
  }

  /**
   * Execute Handoff Protocol
   */
  public static executeHandoff(session: PatientSession, tenant: TenantConfig): string {
    session.currentState = 'HUMAN_HANDOFF';

    const s = session.slots || {};
    const branch = tenant.branches.find(b => b.id === s.branchId || b.name === s.branchName);
    const doctor = tenant.doctors.find(d => d.id === s.doctorId || d.name === s.doctorName);
    const contactPhone = branch?.phone || doctor?.secretariatPhone || tenant.secretaryPhone;

    return `تمام عيني، راح أحول محادثتك فوراً للسكرتير لمساعدتك بالشكل المطلوب.
تفضل رقم التواصل المباشر: ${contactPhone}`;
  }
}
