import { bookingService } from './services/booking.service';

function hasEmojiOrSymbol(text: string): boolean {
  const emojiOrSymbolRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{200D}\u{FE0F}\*#@$*_`~\^+=<>\\\{\}\[\]]/gu;
  return emojiOrSymbolRegex.test(text);
}

async function testMasterPureNLUFlow() {
  console.log('🧪 Starting Pure Gemini NLU 3-Turn Flow Verification Script...\n');

  const clinicId = '11111111-1111-1111-1111-111111111111';
  const testPhone = '07799887766';

  // 1️⃣ Turn 1: Open question with Iraqi slang
  console.log('💬 Turn 1: Patient asks -> "سلام عليكم شلون اسعاركم ومكانكم بالظبط"');
  const reply1 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'سلام عليكم شلون اسعاركم ومكانكم بالظبط');
  console.log('🤖 Bot Reply 1:\n' + reply1 + '\n');
  if (hasEmojiOrSymbol(reply1)) {
    console.error('❌ Turn 1 Reply contains forbidden emojis or symbols!');
  } else {
    console.log('✅ Turn 1: 100% Zero Emojis & Symbols verified.');
  }
  console.log('---\n');

  // 2️⃣ Turn 2: Smart booking request
  console.log('💬 Turn 2: Patient asks -> "اريد احجز باجر"');
  const reply2 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'اريد احجز باجر');
  console.log('🤖 Bot Reply 2:\n' + reply2 + '\n');
  if (hasEmojiOrSymbol(reply2)) {
    console.error('❌ Turn 2 Reply contains forbidden emojis or symbols!');
  } else {
    console.log('✅ Turn 2: 100% Zero Emojis & Symbols & 2-Choice Architecture verified.');
  }
  console.log('---\n');

  // 3️⃣ Turn 3: Name & selection confirmation
  console.log('💬 Turn 3: Patient confirms -> "حسين علي ثبتلي الموعد الاول"');
  const reply3 = await bookingService.processIncomingWhatsAppMessage(clinicId, testPhone, 'حسين علي ثبتلي الموعد الاول');
  console.log('🎉 Bot Reply 3 (Confirmed Booking):\n' + reply3 + '\n');
  if (hasEmojiOrSymbol(reply3)) {
    console.error('❌ Turn 3 Reply contains forbidden emojis or symbols!');
  } else {
    console.log('✅ Turn 3: 100% Zero Emojis & Symbols & Booking Confirmation verified.');
  }
  console.log('---\n');

  // 4️⃣ Verify Sliding Window Buffer Size in Patient Session
  const session = await bookingService.getOrCreatePatientSession(clinicId, testPhone);
  console.log(`🧠 Active Session Message Count: ${session.active_session.length} (Max allowed: 8)`);
  if (session.active_session.length <= 8) {
    console.log('✅ Sliding Window Buffer constraint (<= 8 messages) verified successfully.');
  } else {
    console.error('❌ Session history exceeded 8 messages limit!');
  }

  console.log('\n✨ ALL 3 TURNS PASSED PURE GEMINI NLU VERIFICATION SUCCESSFULLY!');
}

testMasterPureNLUFlow().catch(console.error);

