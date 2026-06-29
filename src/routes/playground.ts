import { Router, Request, Response } from 'express';
import { GeminiService } from '../services/gemini.service';
import { SessionManager } from '../utils/session-manager';
import { TenantManager } from '../config/tenant-manager';

const router = Router();

/**
 * POST /api/test-chat
 * Simulates a WhatsApp chat turn. Returns the bot's reply in JSON format.
 */
router.post('/api/test-chat', async (req: Request, res: Response) => {
  try {
    const { message, phoneNumber, phoneNumberId } = req.body;

    if (!message || !phoneNumber || !phoneNumberId) {
      res.status(400).json({ error: 'Missing required fields: message, phoneNumber, phoneNumberId' });
      return;
    }

    console.log(`🧪 [Playground Chat] Message from ${phoneNumber} | Tenant: ${phoneNumberId} | Content: "${message}"`);

    // 1. Retrieve the patient's existing conversation history
    const history = SessionManager.getHistory(phoneNumber);

    // 2. Feed the turn to Gemini
    const { responseText, updatedHistory } = await GeminiService.handleChatTurn(
      phoneNumberId,
      phoneNumber,
      message,
      history
    );

    // 3. Save the updated history
    SessionManager.saveHistory(phoneNumber, updatedHistory);

    res.status(200).json({
      reply: responseText,
      history: updatedHistory
    });
  } catch (error: any) {
    console.error('❌ Playground chat error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/reset-session
 * Resets history for a phone number.
 */
router.post('/api/reset-session', (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      res.status(400).json({ error: 'Missing phoneNumber' });
      return;
    }
    SessionManager.clearHistory(phoneNumber);
    console.log(`🗑️ [Playground] Reset session history for: ${phoneNumber}`);
    res.status(200).json({ success: true, message: 'Session history cleared' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/session-history
 * Retrieves current history.
 */
router.get('/api/session-history', (req: Request, res: Response) => {
  try {
    const phoneNumber = req.query.phoneNumber as string;
    if (!phoneNumber) {
      res.status(400).json({ error: 'Missing phoneNumber' });
      return;
    }
    const history = SessionManager.getHistory(phoneNumber);
    res.status(200).json({ history });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /playground
 * Serves the beautiful, premium HTML developer playground interface.
 */
router.get('/playground', (req: Request, res: Response) => {
  const tenants = TenantManager.getAllTenants();
  const tenantOptions = Object.entries(tenants).map(([id, t]) => {
    return `<option value="${id}">${t.clinicName} (${id})</option>`;
  }).join('\n');

  const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AuraMed - Chat Playground</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Cairo:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-gradient: radial-gradient(circle at top right, #1a0e30, #090412);
      --panel-bg: rgba(20, 11, 40, 0.45);
      --glass-border: rgba(255, 255, 255, 0.08);
      --text-main: #f3f0f7;
      --text-muted: #a69bb5;
      --primary: #9d4edd;
      --primary-hover: #b5179e;
      --primary-glow: rgba(157, 78, 221, 0.4);
      --accent: #4cc9f0;
      --user-bubble: linear-gradient(135deg, #7209b7, #560bad);
      --bot-bubble: rgba(255, 255, 255, 0.06);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Cairo', 'Outfit', sans-serif;
    }

    body {
      background: var(--bg-gradient);
      color: var(--text-main);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Header */
    header {
      background: rgba(10, 5, 22, 0.8);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--glass-border);
      padding: 15px 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 10;
    }

    .logo-container {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      color: #fff;
      font-size: 1.2rem;
      box-shadow: 0 0 15px var(--primary-glow);
    }

    h1 {
      font-size: 1.4rem;
      font-weight: 700;
      letter-spacing: 0.5px;
      background: linear-gradient(120deg, #fff, var(--accent));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .header-badge {
      background: rgba(76, 201, 240, 0.15);
      border: 1px solid rgba(76, 201, 240, 0.3);
      color: var(--accent);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 600;
    }

    /* Main Layout */
    .main-container {
      flex: 1;
      display: flex;
      overflow: hidden;
      position: relative;
    }

    /* Sidebar Controls */
    .sidebar {
      width: 350px;
      background: rgba(12, 6, 25, 0.6);
      border-left: 1px solid var(--glass-border);
      display: flex;
      flex-direction: column;
      padding: 25px;
      gap: 20px;
      overflow-y: auto;
    }

    .section-title {
      font-size: 0.95rem;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 10px;
      font-weight: 600;
    }

    .control-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    label {
      font-size: 0.85rem;
      color: var(--text-muted);
      font-weight: 500;
    }

    input, select {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      padding: 10px 12px;
      color: var(--text-main);
      font-size: 0.9rem;
      outline: none;
      transition: all 0.3s;
      width: 100%;
    }

    input:focus, select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 10px var(--primary-glow);
      background: rgba(255, 255, 255, 0.08);
    }

    .btn {
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      color: white;
      border: none;
      border-radius: 8px;
      padding: 12px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    }

    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(157, 78, 221, 0.4);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--glass-border);
      color: var(--text-main);
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
      box-shadow: none;
      transform: none;
    }

    /* Quick Templates */
    .templates-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }

    .template-item {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      padding: 10px;
      font-size: 0.85rem;
      color: var(--text-muted);
      cursor: pointer;
      text-align: right;
      transition: all 0.2s;
    }

    .template-item:hover {
      background: rgba(157, 78, 221, 0.1);
      border-color: rgba(157, 78, 221, 0.4);
      color: var(--text-main);
    }

    /* Chat Area */
    .chat-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: rgba(16, 9, 32, 0.2);
    }

    .chat-messages {
      flex: 1;
      padding: 30px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .message {
      max-width: 70%;
      display: flex;
      flex-direction: column;
      animation: fadeIn 0.3s ease-out forwards;
    }

    .message.user {
      align-self: flex-start;
    }

    .message.bot {
      align-self: flex-end;
    }

    .message-bubble {
      padding: 12px 18px;
      border-radius: 16px;
      font-size: 0.95rem;
      line-height: 1.5;
      position: relative;
    }

    .message.user .message-bubble {
      background: var(--user-bubble);
      color: white;
      border-bottom-right-radius: 4px;
      box-shadow: 0 4px 15px rgba(114, 9, 183, 0.25);
    }

    .message.bot .message-bubble {
      background: var(--bot-bubble);
      border: 1px solid var(--glass-border);
      color: var(--text-main);
      border-bottom-left-radius: 4px;
      backdrop-filter: blur(10px);
    }

    .message-time {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 6px;
      align-self: flex-end;
    }

    .message.user .message-time {
      align-self: flex-start;
    }

    /* Chat Input */
    .chat-input-area {
      padding: 20px 30px;
      border-top: 1px solid var(--glass-border);
      background: rgba(10, 5, 20, 0.85);
      backdrop-filter: blur(10px);
      display: flex;
      gap: 15px;
      align-items: center;
    }

    .chat-input-wrapper {
      flex: 1;
      position: relative;
    }

    .chat-input-wrapper input {
      padding: 14px 20px;
      border-radius: 25px;
      font-size: 0.95rem;
    }

    .chat-input-area button {
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: white;
      box-shadow: 0 4px 15px var(--primary-glow);
      transition: all 0.3s;
      flex-shrink: 0;
    }

    .chat-input-area button:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 20px rgba(157, 78, 221, 0.6);
    }

    .chat-input-area button svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
      transform: rotate(180deg);
    }

    /* Typing Indicator */
    .typing-indicator {
      display: none;
      align-self: flex-end;
      background: var(--bot-bubble);
      border: 1px solid var(--glass-border);
      padding: 12px 20px;
      border-radius: 16px;
      border-bottom-left-radius: 4px;
      align-items: center;
      gap: 6px;
    }

    .typing-dot {
      width: 8px;
      height: 8px;
      background: var(--accent);
      border-radius: 50%;
      animation: bounce 1.4s infinite ease-in-out both;
    }

    .typing-dot:nth-child(1) { animation-delay: -0.32s; }
    .typing-dot:nth-child(2) { animation-delay: -0.16s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1.0); }
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 6px;
    }
    ::-webkit-scrollbar-track {
      background: rgba(0,0,0,0.1);
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255,255,255,0.2);
    }
  </style>
</head>
<body>

  <header>
    <div class="logo-container">
      <div class="logo-icon">A</div>
      <div>
        <h1>بيئة تجربة بوت العيادة الذكي</h1>
      </div>
    </div>
    <div class="header-badge">مطور محلي نشط</div>
  </header>

  <div class="main-container">
    
    <!-- Sidebar -->
    <div class="sidebar">
      <div>
        <h3 class="section-title">إعدادات المحاكاة</h3>
        
        <div class="control-group" style="margin-bottom: 15px;">
          <label>الفرع / العيادة</label>
          <select id="tenantSelect">
            ${tenantOptions}
          </select>
        </div>

        <div class="control-group" style="margin-bottom: 15px;">
          <label>رقم هاتف المراجع (المحاكاة)</label>
          <input type="text" id="phoneNumberInput" value="9647881015584">
        </div>

        <button class="btn btn-secondary" id="resetBtn" style="width: 100%;">
          🗑️ إعادة تعيين الجلسة والذاكرة
        </button>
      </div>

      <div style="margin-top: 15px;">
        <h3 class="section-title">رسائل سريعة للاختبار</h3>
        <div class="templates-grid">
          <div class="template-item" onclick="sendTemplate('هلو عيني، أريد أحجز فحص أسنان')">"هلو عيني، أريد أحجز فحص أسنان"</div>
          <div class="template-item" onclick="sendTemplate('بشكد فيلر الشفايف عدكم؟')">"بشكد فيلر الشفايف عدكم؟"</div>
          <div class="template-item" onclick="sendTemplate('شنو فروعكم وشنو ساعات العمل؟')">"شنو فروعكم وشنو ساعات العمل؟"</div>
          <div class="template-item" onclick="sendTemplate('احجزلي موعد يوم الاثنين العصر بالمنصور')">"احجزلي موعد يوم الاثنين العصر بالمنصور"</div>
          <div class="template-item" onclick="sendTemplate('اسمي لويس ورقم تلفوني نفسه هذا')">"اسمي لويس ورقم تلفوني نفسه هذا"</div>
          <div class="template-item" onclick="sendTemplate('اي ثبت الموعد عيني')">"اي ثبت الموعد عيني"</div>
        </div>
      </div>
    </div>

    <!-- Chat Workspace -->
    <div class="chat-container">
      <div class="chat-messages" id="chatMessages">
        
        <!-- Welcome Message -->
        <div class="message bot">
          <div class="message-bubble">
            أهلاً بك عيني لويس في لوحة تجربة الذكاء الاصطناعي للعيادة. 🌟
            <br><br>
            هنا تكدر تدردش ويا الايجنت مباشرة وتشوف الردود وتجرب المواعيد والأسعار بدون ما تحتاج نفق أو واتساب أو Meta. اكتب أي رسالة بالأسفل أو اضغط على الرسائل الجاهزة للبدء!
          </div>
          <div class="message-time">الآن</div>
        </div>

      </div>

      <!-- Typing indicator -->
      <div class="typing-indicator" id="typingIndicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>

      <!-- Input Bar -->
      <div class="chat-input-area">
        <div class="chat-input-wrapper">
          <input type="text" id="chatInput" placeholder="اكتب رسالتك هنا للمحاكاة..." onkeydown="handleKey(event)">
        </div>
        <button id="sendBtn" onclick="sendMessage()">
          <svg viewBox="0 0 24 24">
            <path d="M2 21l21-9L2 3v7l15 2-15 2z"/>
          </svg>
        </button>
      </div>

    </div>

  </div>

  <script>
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const typingIndicator = document.getElementById('typingIndicator');
    const tenantSelect = document.getElementById('tenantSelect');
    const phoneNumberInput = document.getElementById('phoneNumberInput');
    const resetBtn = document.getElementById('resetBtn');

    function appendMessage(text, isUser = true) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'message ' + (isUser ? 'user' : 'bot');
      
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      bubble.innerText = text;
      
      const time = document.createElement('div');
      time.className = 'message-time';
      time.innerText = new Date().toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
      
      msgDiv.appendChild(bubble);
      msgDiv.appendChild(time);
      chatMessages.appendChild(msgDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function sendMessage(customText = null) {
      const text = customText || chatInput.value.trim();
      if (!text) return;

      if (!customText) chatInput.value = '';

      appendMessage(text, true);

      // Show typing indicator
      typingIndicator.style.display = 'flex';
      chatMessages.scrollTop = chatMessages.scrollHeight;

      try {
        const response = await fetch('/api/test-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            phoneNumber: phoneNumberInput.value.trim(),
            phoneNumberId: tenantSelect.value
          })
        });

        const data = await response.json();
        typingIndicator.style.display = 'none';

        if (data.reply) {
          appendMessage(data.reply, false);
        } else {
          appendMessage('❌ حدث خطأ في معالجة الطلب.', false);
        }
      } catch (err) {
        typingIndicator.style.display = 'none';
        appendMessage('❌ تعذر الاتصال بالسيرفر المحلي.', false);
      }
    }

    function sendTemplate(text) {
      sendMessage(text);
    }

    function handleKey(e) {
      if (e.key === 'Enter') {
        sendMessage();
      }
    }

    resetBtn.addEventListener('click', async () => {
      try {
        const response = await fetch('/api/reset-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phoneNumber: phoneNumberInput.value.trim()
          })
        });
        const data = await response.json();
        if (data.success) {
          // Clear messages except welcome
          chatMessages.innerHTML = \`
            <div class="message bot">
              <div class="message-bubble">
                🗑️ تم تفريغ ذاكرة الجلسة الحالية وإعادة تعيين الذاكرة بنجاح! شلون أكدر أساعدك هسة عيني؟
              </div>
              <div class="message-time">الآن</div>
            </div>
          \`;
        }
      } catch (err) {
        alert('تعذر إعادة تعيين الجلسة');
      }
    });
  </script>
</body>
</html>
  `;

  res.status(200).send(html);
});

export default router;
