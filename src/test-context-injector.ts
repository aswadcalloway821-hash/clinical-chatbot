import { bookingService } from './services/booking.service';

async function testContextInjector() {
  console.log('🧪 Testing Phase 1: Real Supabase Zero-Hallucination Context Injector...\n');

  const clinicId = '11111111-1111-1111-1111-111111111111';

  const context = await bookingService.getClinicContext(clinicId);
  console.log('🏥 Real Clinic Context fetched from Supabase:');
  console.log(JSON.stringify(context, null, 2), '\n');

  console.log('💬 Testing interactive message response with injected context:');
  const reply = await bookingService.processIncomingWhatsAppMessage(clinicId, '07700112244', 'اريد احجز موعد');
  console.log('🤖 Reply:\n' + reply + '\n');
}

testContextInjector().catch(console.error);
