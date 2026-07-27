export class WhatsAppService {
  /**
   * 🔹 دالة إرسال الرسالة النصية الصادرة إلى واتساب المريض عبر Meta Graph API
   */
  async sendTextMessage(toPhone: string, textMessage: string): Promise<boolean> {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;

    if (!token || !phoneNumberId || phoneNumberId.includes('ضع_معرف')) {
      console.warn(`[WhatsAppService Sandbox] Message to [${toPhone}]: "${textMessage}" (Awaiting PHONE_NUMBER_ID in .env for live Meta delivery)`);
      return true;
    }

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhone,
      type: 'text',
      text: {
        preview_url: false,
        body: textMessage,
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error('❌ Failed to send WhatsApp message via Meta API:', JSON.stringify(responseData));
        return false;
      }

      console.log(`✅ WhatsApp Message Sent Successfully to [${toPhone}]`);
      return true;
    } catch (error: any) {
      console.error('❌ Failed to send WhatsApp message:', error.message || error);
      return false;
    }
  }

  /**
   * معالجة الرسائل الواردة من الويب هوك
   */
  async handleIncomingMessage(payload: any): Promise<void> {
    console.log('[WhatsAppService] Received incoming message payload:', JSON.stringify(payload));
  }
}

export const whatsAppService = new WhatsAppService();
