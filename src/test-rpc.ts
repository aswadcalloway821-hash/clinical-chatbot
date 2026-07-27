import { bookingService } from './services/booking.service';

async function testRpcCalls() {
  console.log('🧪 Starting Supabase RPC Test Script...\n');

  // معرفات تجريبية لاختبار الاتصال والـ RPC
  const dummyClinicId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
  const dummyPhone = '07701234567';
  const dummyName = 'حسن علي';

  try {
    console.log('1️⃣ Testing getOrCreatePatientSession...');
    const sessionResult = await bookingService.getOrCreatePatientSession(
      dummyClinicId,
      dummyPhone,
      dummyName
    );
    console.log('✅ getOrCreatePatientSession Result:', JSON.stringify(sessionResult, null, 2));
  } catch (error: any) {
    console.error('❌ testRpcCalls Error:', error.message);
  }
}

testRpcCalls();
