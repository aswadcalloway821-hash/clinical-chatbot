import { bookingService } from './services/booking.service';

async function testTelemetryDataInspector() {
  console.log('🧪 Testing Live Web Chat Simulator Telemetry Inspector API...\n');

  const clinicId = '11111111-1111-1111-1111-111111111111';
  const testPhone = '07899001122';

  console.log('💬 Test Message: "سلام عليكم شلون اسعار الكشفية ومكانكم؟"');
  const res1 = await bookingService.processTestMessageWithTelemetry(clinicId, testPhone, 'سلام عليكم شلون اسعار الكشفية ومكانكم؟');

  console.log('🤖 Bot Reply:', res1.botReply);
  console.log('🧠 Intent:', res1.intent);
  console.log('⚡ Execution Time:', res1.executionTimeMs, 'ms');
  console.log('📜 Active Session Memory Count:', res1.chatHistory.length, '\n');

  console.log('💬 Test Message: "أيمن حسين - تمام ثبت الموعد"');
  const res2 = await bookingService.processTestMessageWithTelemetry(clinicId, testPhone, 'أيمن حسين - تمام ثبت الموعد');

  console.log('🎉 Bot Reply:', res2.botReply);
  console.log('🧠 Intent:', res2.intent);
  console.log('💎 Booking Result Code:', res2.bookingResult?.booking_code || 'None');
  console.log('⚡ Execution Time:', res2.executionTimeMs, 'ms\n');
}

testTelemetryDataInspector().catch(console.error);
