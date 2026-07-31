export class HandoffManager {
    /**
     * Check if session should trigger Human Handoff
     */
    static shouldTriggerHandoff(session, intent, confidence) {
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
    static executeHandoff(session, tenant) {
        session.currentState = 'HUMAN_HANDOFF';
        return `تمام عيني، راح أحول محادثتك فوراً للسكرتير لمساعدتك بالشكل المطلوب.
تفضل رقم التواصل المباشر: ${tenant.secretaryPhone}`;
    }
}
//# sourceMappingURL=handoff-manager.js.map