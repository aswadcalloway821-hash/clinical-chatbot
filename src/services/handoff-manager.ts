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
    
    return `أعتذر منك أستاذي العزيز، راح أحول محادثتك فوراً للسكرتارية البشرية لمساعدتك بكل تفاصيل طلبك.
تفضل رقم السكرتير المباشر: ${tenant.secretaryPhone}
وسيعاود التواصل وياك بأسرع وقت، نورتنا بمركز ${tenant.clinicName}.`;
  }
}
