import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import whatsappRoutes from './routes/whatsapp.js';
import { WatchdogService } from './services/watchdog.js';
import { FsmStateManager } from './fsm/state-manager.js';
import { GoogleSheetsService } from './services/google-sheets.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/', whatsappRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'UP', service: 'Sara Digital Clinic WhatsApp Engine', timestamp: new Date() });
});

// Initialize Watchdog & Revenue Recovery
(async () => {
  try {
    const tenant = await GoogleSheetsService.getTenantConfig();
    console.log(`[Tenant Loaded Successfully]: Clinic = "${tenant.clinicName}", Branches = ${tenant.branches.map(b => b.name).join(', ')}`);

    // Register WhatsApp sender callback for Watchdog
    WatchdogService.registerSendCallback(async (phone: string, text: string) => {
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      if (phoneId && token) {
        await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } })
        });
      }
    });

    WatchdogService.startMonitoring(FsmStateManager.getSessionsStore(), tenant);
    console.log('[Watchdog Service] Started session monitor worker with Live WhatsApp Dispatcher.');
  } catch (err) {
    console.error('🚨 [Startup Error Loading Tenant Config]:', err);
  }
})();

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Sara Digital Clinic WhatsApp Engine running on port ${PORT}`);
  console.log(`Google Sheet ID: ${process.env.GOOGLE_SHEET_ID}`);
  console.log(`====================================================`);
});

export default app;
