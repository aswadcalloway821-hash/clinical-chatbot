import { GoogleService, BookingData } from './services/google.service';

async function runDoubleBookingTest() {
  console.log('🧪 Starting Double Booking Lock Tests...');

  const branch = 'الكرادة';
  const targetTime = '2026-06-20T17:00:00+03:00'; // 5:00 PM
  const duration = 45; // 45 minutes

  // 1. Book Patient A at 5:00 PM
  console.log('\n1. Booking Patient A at 5:00 PM (Expected: Success)...');
  const bookingA: BookingData = {
    patientName: 'أحمد المياحي',
    phoneNumber: '9647711111111',
    branch,
    serviceName: 'شلع سن',
    bookingDatetime: targetTime,
    durationMinutes: duration,
    status: 'Confirmed'
  };

  const successA = await GoogleService.createCalendarEvent(bookingA);
  console.log('Patient A booking result:', successA ? '✅ Success' : '❌ Failed');

  // 2. Try to book Patient B at 5:00 PM (Exact same slot)
  console.log('\n2. Booking Patient B at 5:00 PM (Expected: Fail)...');
  const bookingB: BookingData = {
    patientName: 'حسين الخفاجي',
    phoneNumber: '9647722222222',
    branch,
    serviceName: 'شلع سن',
    bookingDatetime: targetTime,
    durationMinutes: duration,
    status: 'Confirmed'
  };

  const successB = await GoogleService.createCalendarEvent(bookingB);
  console.log('Patient B booking result:', successB ? '❌ Success (BUG!)' : '✅ Failed (Correct!)');

  // 3. Try to book Patient C at 4:30 PM (Overlapping slot: 4:30 PM to 5:15 PM overlaps with A\'s 5:00 PM to 5:45 PM)
  console.log('\n3. Booking Patient C at 4:30 PM (Expected: Fail)...');
  const bookingC: BookingData = {
    patientName: 'مريم الأسدي',
    phoneNumber: '9647733333333',
    branch,
    serviceName: 'شلع سن',
    bookingDatetime: '2026-06-20T16:30:00+03:00',
    durationMinutes: duration,
    status: 'Confirmed'
  };

  const successC = await GoogleService.createCalendarEvent(bookingC);
  console.log('Patient C booking result:', successC ? '❌ Success (BUG!)' : '✅ Failed (Correct!)');

  // Verdict
  if (successA && !successB && !successC) {
    console.log('\n🎉 DOUBLE BOOKING LOCK TESTS PASSED PERFECTLY!');
  } else {
    console.error('\n❌ DOUBLE BOOKING LOCK TESTS FAILED!');
  }
}

runDoubleBookingTest();
