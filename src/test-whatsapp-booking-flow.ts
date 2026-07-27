import { bookingService } from './services/booking.service';

async function testFullWhatsAppBookingFlow() {
  console.log('🧪 Starting Full Interactive WhatsApp Booking Flow Test...\n');

  const clinicId = '11111111-1111-1111-1111-111111111111';
  const testPhone = '07799887766';

  // 1️⃣ Turn 1: Patient asks to book
  console.log('💬 Turn 1: Patient sends -> "السلام عليكم أريد أحجز موعد أسنان"');
  const reply1 = await bookingService.processIncomingWhatsAppMessage(
    clinicId,
    testPhone,
    'السلام عليكم أريد أحجز موعد أسنان'
  );
  console.log('🤖 Bot Reply 1:\n' + reply1 + '\n---\n');

  // 2️⃣ Turn 2: Patient confirms and provides full name
  console.log('💬 Turn 2: Patient sends -> "أحمد علي المحمداوي - تمام ثبت الموعد"');
  const reply2 = await bookingService.processIncomingWhatsAppMessage(
    clinicId,
    testPhone,
    'أحمد علي المحمداوي - تمام ثبت الموعد'
  );
  console.log('🎉 Bot Reply 2 (Confirmed Booking):\n' + reply2 + '\n');
}

testFullWhatsAppBookingFlow().catch(console.error);
