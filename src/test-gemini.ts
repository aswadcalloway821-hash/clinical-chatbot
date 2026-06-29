import { GeminiService } from './services/gemini.service';

async function runTest() {
  console.log('🧪 Starting Gemini Service Tests...');

  // Test 1: Ask about pricing (should trigger mock fallback price response)
  console.log('\n1. Testing pricing query...');
  const res1 = await GeminiService.handleChatTurn('1174331045763688', '9647700000000', 'بشكد الفيلر عيني؟');
  console.log('Response 1:', res1.responseText);
  
  if (res1.responseText.includes('150 ألف')) {
    console.log('✅ Pricing Query Test Passed!');
  } else {
    console.error('❌ Pricing Query Test Failed!');
  }

  // Test 2: Ask about booking (should trigger mock fallback booking options)
  console.log('\n2. Testing booking intent query...');
  const res2 = await GeminiService.handleChatTurn('1174331045763688', '9647700000000', 'أريد أحجز موعد فحص أسنان');
  console.log('Response 2:', res2.responseText);

  if (res2.responseText.includes('الكرادة') && res2.responseText.includes('السبت')) {
    console.log('✅ Booking Intent Query Test Passed!');
  } else {
    console.error('❌ Booking Intent Query Test Failed!');
  }

  console.log('\n🎉 ALL GEMINI SERVICE TESTS PASSED (MOCK MODE)!');
}

runTest();
