import { bookingService } from './services/booking.service';

async function testMasterPureNLUFlow() {
  console.log('🧪 Testing Master Pure Gemini 2.5 Flash NLU Engine with Choice Architecture & 8-Message Buffer...\n');

  const clinicId = '11111111-1111-1111-1111-111111111111';
  const testPhone = '07799887766';

  // 1️⃣ Turn 1: Open question with Iraqi slang
  console.log('💬 Turn 1: Patient asks -> "سلام عليكم شلون اسعاركم ومكانكم بالظبط"');
  const reply1 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'سلام عليكم شلون اسعاركم ومكانكم بالظبط');
  console.log('🤖 Bot Reply 1:\n' + reply1 + '\n---\n');

  // 2️⃣ Turn 2: Smart booking request
  console.log('💬 Turn 2: Patient asks -> "اريد احجز باجر"');
  const reply2 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'اريد احجز باجر');
  console.log('🤖 Bot Reply 2:\n' + reply2 + '\n---\n');

  // 3️⃣ Turn 3: Name & selection confirmation
  console.log('💬 Turn 3: Patient confirms -> "حسين علي ثبتلي الموعد الاول"');
  const reply3 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'حسين علي ثبتلي الموعد الاول');
  console.log('🎉 Bot Reply 3 (Confirmed Booking):\n' + reply3 + '\n');
}

testMasterPureNLUFlow().catch(console.error);
