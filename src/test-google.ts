import { GoogleService, BookingData } from './services/google.service';

async function runTest() {
  console.log('🧪 Starting Google Service Tests...');

  // Test 1: Fetch clinic branches
  console.log('\n1. Fetching Branches...');
  const branches = await GoogleService.getClinicInfo('Clinic_Metadata');
  console.log('Branches found:', branches);

  // Test 2: Fetch services config
  console.log('\n2. Fetching Services...');
  const services = await GoogleService.getClinicInfo('Services_Config');
  console.log('Services found:', services);

  // Test 3: Check initial availability
  console.log('\n3. Checking Availability for الكرادة on 2026-06-20 (Duration: 45 mins)...');
  const initialSlots = await GoogleService.checkCalendarAvailability('الكرادة', '2026-06-20', 45);
  console.log(`Found ${initialSlots.length} available slots:`);
  console.log(initialSlots.slice(0, 5), '...'); // show first 5

  // Find 4:00 PM slot (which matches 16:00:00+03:00)
  const targetSlot = '2026-06-20T16:00:00+03:00';
  if (!initialSlots.includes(targetSlot)) {
    console.error(`❌ Target slot ${targetSlot} not found in available slots!`);
    return;
  }
  console.log(`✅ Target slot ${targetSlot} is initially available.`);

  // Test 4: Book the slot at 4:00 PM (16:00)
  console.log(`\n4. Booking slot at 4:00 PM (Duration: 45 mins)...`);
  const mockBooking: BookingData = {
    patientName: 'علي العراقي',
    phoneNumber: '9647700000000',
    branch: 'الكرادة',
    serviceName: 'شلع سن',
    bookingDatetime: targetSlot,
    durationMinutes: 45,
    status: 'Confirmed',
    notes: 'قلع الضاحك العلوي'
  };

  const bookingLogged = await GoogleService.logPatientBooking(mockBooking);
  const eventCreated = await GoogleService.createCalendarEvent(mockBooking);

  if (bookingLogged && eventCreated) {
    console.log('✅ Mock booking created and logged successfully.');
  } else {
    console.error('❌ Failed to create mock booking!');
  }

  // Test 5: Re-check availability
  console.log('\n5. Re-checking Availability after booking...');
  const updatedSlots = await GoogleService.checkCalendarAvailability('الكرادة', '2026-06-20', 45);
  
  // Verify that the booked slot is gone
  const isBookedSlotStillAvailable = updatedSlots.includes(targetSlot);
  // Verify that the 3:30 PM (15:30) slot is also gone, because booking is 16:00-16:45,
  // and a 45-minute booking starting at 15:30 would end at 16:15, causing an overlap!
  const isOverlapSlotStillAvailable = updatedSlots.includes('2026-06-20T15:30:00+03:00');
  // Verify that the 3:00 PM (15:00) slot is STILL available (ends at 15:45, no overlap with 16:00)
  const isFreeSlotAvailable = updatedSlots.includes('2026-06-20T15:00:00+03:00');

  console.log(`- Is 4:00 PM slot still available? (Expected: false): ${isBookedSlotStillAvailable}`);
  console.log(`- Is 3:30 PM slot (overlapping) still available? (Expected: false): ${isOverlapSlotStillAvailable}`);
  console.log(`- Is 3:00 PM slot (free) still available? (Expected: true): ${isFreeSlotAvailable}`);

  if (!isBookedSlotStillAvailable && !isOverlapSlotStillAvailable && isFreeSlotAvailable) {
    console.log('\n🎉 ALL AVAILABILITY ALGORITHM TESTS PASSED!');
  } else {
    console.error('\n❌ AVAILABILITY ALGORITHM TEST FAILED!');
  }
}

runTest();
