import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Render Secret File Compatibility
const renderSecretEnvPath = '/etc/secrets/.env';
if (fs.existsSync(renderSecretEnvPath)) {
  dotenv.config({ path: renderSecretEnvPath });
}
dotenv.config();

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import bookingRoutes from './routes/booking.routes';
import webhookRoutes from './routes/webhook.routes';

const app: Express = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// خدمة الملفات الثابتة لصفحة المحاكاة والتتبع
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Routes
app.use('/api/booking', bookingRoutes);
app.use('/', bookingRoutes); // دعم مسار /api/test-chat/message مباشرة
app.use('/api/webhook', webhookRoutes);
app.use('/webhook', webhookRoutes);

// صفحة محاكي المحادثة وتتبع البيانات
app.get('/test-chat', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicPath, 'chat.html'));
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    verifyTokenConfigured: Boolean(process.env.WEBHOOK_VERIFY_TOKEN),
    geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
  });
});

app.listen(PORT, () => {
  console.log(`⚡ [Sijil Engine] Server running on port ${PORT}`);
  console.log(`🧪 [Telemetry Dashboard] Live Test Chat Simulator available at: http://localhost:${PORT}/test-chat`);
});

export default app;
