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

async function createTwoMoreBookings() {
  console.log('⚡ Starting Creation of 2 Additional Live Bookings in Supabase...\n');

  // ===================================================
  // 🔹 الحجز الأول الإضافي (العيادة 1 - د. علي)
  // ===================================================
  console.log('1️⃣ Creating Session & Booking for Patient: زينب عباس المحمداوي ...');
  const clinic1Id = '11111111-1111-1111-1111-111111111111';
  const offering1Id = '2e4ede71-8ff6-4597-8067-b9a74c36d0c4';

  const session1Res = await makeRequest(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/bookings/session',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    JSON.stringify({
      clinic_id: clinic1Id,
      patient_phone: '07709876543',
      patient_name: 'زينب عباس المحمداوي',
    })
  );

  const p1Id = session1Res.data?.data?.patient_id;
  const s1Id = session1Res.data?.data?.session_id;

  const booking1Res = await makeRequest(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/bookings/create',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    JSON.stringify({
      clinic_id: clinic1Id,
      patient_id: p1Id,
      session_id: s1Id,
      clinic_offering_id: offering1Id,
      appointment_time: '2026-07-29T10:30:00Z',
    })
  );

  console.log('🎉 RESULT BOOKING 1:', booking1Res.statusCode, JSON.stringify(booking1Res.data, null, 2), '\n');

  // ===================================================
  // 🔹 الحجز الثاني الإضافي (العيادة 2 - مجمع النخبة)
  // ===================================================
  console.log('2️⃣ Creating Session & Booking for Patient: مصطفى طارق الخفاجي ...');
  const clinic2Id = '22222222-2222-2222-2222-222222222222';
  const offering2Id = '8d8e22b6-14f1-4592-a482-5427d4029759';

  const session2Res = await makeRequest(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/bookings/session',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    JSON.stringify({
      clinic_id: clinic2Id,
      patient_phone: '07812345678',
      patient_name: 'مصطفى طارق الخفاجي',
    })
  );

  const p2Id = session2Res.data?.data?.patient_id;
  const s2Id = session2Res.data?.data?.session_id;

  const booking2Res = await makeRequest(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/bookings/create',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    JSON.stringify({
      clinic_id: clinic2Id,
      patient_id: p2Id,
      session_id: s2Id,
      clinic_offering_id: offering2Id,
      appointment_time: '2026-07-30T17:00:00Z',
    })
  );

  console.log('🎉 RESULT BOOKING 2:', booking2Res.statusCode, JSON.stringify(booking2Res.data, null, 2), '\n');
}

createTwoMoreBookings().catch(console.error);
