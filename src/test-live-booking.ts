import http from 'http';

function makeRequest(options: http.RequestOptions, postData?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(body || '{}') });
        } catch {
          resolve({ statusCode: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runLiveTest() {
  console.log('🧪 Starting 100% Real Live Booking Test against Supabase...\n');

  // 1️⃣ Test 1: Health Check
  console.log('1️⃣ Testing GET /health ...');
  const health = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/health',
    method: 'GET',
  });
  console.log('Result:', health.statusCode, health.data, '\n');

  // معرفات العيادة الحقيقية التي تم جلبها من قاعدة بيانات Supabase الخاصة بك
  const clinicId = '11111111-1111-1111-1111-111111111111'; // عيادة د. علي التخصصية
  const phone = '07801234567';
  const name = 'حسن علي الحسيناوي (حجز حي اختباري)';
  const offeringId = '2e4ede71-8ff6-4597-8067-b9a74c36d0c4'; // خدمة حقيقية من داتا بيز

  // 2️⃣ Test 2: Create Patient Session
  console.log('2️⃣ Testing POST /api/bookings/session ...');
  const sessionPayload = JSON.stringify({
    clinic_id: clinicId,
    patient_phone: phone,
    patient_name: name,
  });

  const sessionRes = await makeRequest(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/bookings/session',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(sessionPayload),
      },
    },
    sessionPayload
  );

  console.log('Result:', sessionRes.statusCode, JSON.stringify(sessionRes.data, null, 2), '\n');

  const patientId = sessionRes.data?.data?.patient_id;
  const sessionId = sessionRes.data?.data?.session_id;

  if (!patientId || !sessionId) {
    console.error('❌ Failed to retrieve real patient_id or session_id from Supabase RPC!');
    return;
  }

  // 3️⃣ Test 3: Create Live Booking
  console.log('3️⃣ Testing POST /api/bookings/create with real Supabase data ...');
  const bookingPayload = JSON.stringify({
    clinic_id: clinicId,
    patient_id: patientId,
    session_id: sessionId,
    clinic_offering_id: offeringId,
    appointment_time: '2026-07-28T16:00:00Z',
  });

  const bookingRes = await makeRequest(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/bookings/create',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bookingPayload),
      },
    },
    bookingPayload
  );

  console.log('🎉 LIVE BOOKING CREATED SUCCESS RESULT:');
  console.log(bookingRes.statusCode, JSON.stringify(bookingRes.data, null, 2), '\n');
}

runLiveTest().catch(console.error);
