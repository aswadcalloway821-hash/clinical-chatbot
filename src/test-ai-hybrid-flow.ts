import { bookingService } from './services/booking.service';

async function testAIHybridFlowWithRollingMemory() {
  console.log('🧪 Testing Gemini Flash Hybrid AI Engine with 5-Message Rolling Memory...\n');

  const clinicId = '11111111-1111-1111-1111-111111111111';
  const testPhone = '07711223344';

  // 1️⃣ Turn 1: Price Inquiry
  console.log('💬 Turn 1 (Price Inquiry): "شلون أسعار الكشفية عدكم؟"');
  const r1 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'شلون أسعار الكشفية عدكم؟');
  console.log('🤖 Bot Reply 1:\n' + r1 + '\n---\n');

  // 2️⃣ Turn 2: Contextual Follow-up (Location)
  console.log('💬 Turn 2 (Contextual Follow-up): "زين وعيادتكم وين مكانها؟"');
  const r2 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'زين وعيادتكم وين مكانها؟');
  console.log('🤖 Bot Reply 2:\n' + r2 + '\n---\n');

  // 3️⃣ Turn 3: Booking Request
  console.log('💬 Turn 3 (Booking Request): "أريد أحجز عند دكتور علي"');
  const r3 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'أريد أحجز عند دكتور علي');
  console.log('🤖 Bot Reply 3:\n' + r3 + '\n---\n');

  // 4️⃣ Turn 4: Confirmation & Full Name
  console.log('💬 Turn 4 (Confirmation): "حيدر المالكي - تمام ثبت"');
  const r4 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'حيدر المالكي - تمام ثبت');
  console.log('🎉 Bot Reply 4 (Confirmed Booking):\n' + r4 + '\n');
}

testAIHybridFlowWithRollingMemory().catch(console.error);
