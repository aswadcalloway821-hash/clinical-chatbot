import { bookingService } from './services/booking.service';

async function testPhase2Funnel() {
  console.log('🧪 Testing Phase 2: Multi-Branch & Doctor Funnel with State Machine Transitions...\n');

  const clinicId = '11111111-1111-1111-1111-111111111111';
  const testPhone = '07700554433';

  // 1️⃣ Turn 1: Patient asks for specific doctor ("عند د علي")
  console.log('💬 Turn 1: Patient asks -> "أريد أحجز موعد عند د علي"');
  const reply1 = await bookingService.processIncomingWhatsAppMessage(
    clinicId,
    testPhone,
    'أريد أحجز موعد عند د علي'
  );
  console.log('🤖 Bot Reply 1:\n' + reply1 + '\n---\n');

  // 2️⃣ Turn 2: Patient confirms with name ("كرار حيدر الاسدي")
  console.log('💬 Turn 2: Patient inputs name -> "كرار حيدر الاسدي"');
  const reply2 = await bookingService.processIncomingWhatsAppMessage(
    clinicId,
    testPhone,
    'كرار حيدر الاسدي'
  );
  console.log('🎉 Bot Reply 2 (Confirmed State):\n' + reply2 + '\n');
}

testPhase2Funnel().catch(console.error);
