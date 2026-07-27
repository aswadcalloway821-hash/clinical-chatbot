import { bookingService } from './services/booking.service';

async function testFlexibleIraqiBookingEngine() {
  console.log('🧪 Testing Flexible Friendly Iraqi Conversational Engine (Zero Punctuation / Pure Human Style)...\n');

  const clinicId = '11111111-1111-1111-1111-111111111111';
  const testPhone = '07700112233';

  // 1️⃣ Turn 1: Patient asks to book
  console.log('💬 Turn 1: Patient sends -> "سلام عليكم اريد احجز"');
  const reply1 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'سلام عليكم اريد احجز');
  console.log('🤖 Bot Reply 1:\n' + reply1 + '\n---\n');

  // 2️⃣ Turn 2: Short answer ("أوكي")
  console.log('💬 Turn 2: Patient sends -> "أوكي"');
  const reply2 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'أوكي');
  console.log('🤖 Bot Reply 2:\n' + reply2 + '\n---\n');

  // 3️⃣ Turn 3: Full Name ("حيدر كاظم المالكي")
  console.log('💬 Turn 3: Patient sends -> "حيدر كاظم المالكي"');
  const reply3 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'حيدر كاظم المالكي');
  console.log('🎉 Bot Reply 3 (Confirmed Booking):\n' + reply3 + '\n');
}

testFlexibleIraqiBookingEngine().catch(console.error);
