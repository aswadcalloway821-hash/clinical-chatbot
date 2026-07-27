import http from 'http';

function makeRequest(options: http.RequestOptions, postData?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, data: JSON.parse(body || '{}') });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function testEndpoints() {
  console.log('🧪 Testing Sijil Express Server APIs...\n');

  // 1. Health Check Test
  const health = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/health',
    method: 'GET',
  });
  console.log('✅ GET /health Status:', health.statusCode, health.data);

  // 2. Session Validation Test (Missing Fields)
  const sessionValidation = await makeRequest(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/bookings/session',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    JSON.stringify({ clinic_id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' }) // missing patient_phone & patient_name
  );
  console.log('✅ POST /api/bookings/session (Validation Check) Status:', sessionValidation.statusCode, sessionValidation.data);

  // 3. Slots Validation Test (Missing Query Params)
  const slotsValidation = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/bookings/slots',
    method: 'GET',
  });
  console.log('✅ GET /api/bookings/slots (Validation Check) Status:', slotsValidation.statusCode, slotsValidation.data);
}

testEndpoints().catch(console.error);
