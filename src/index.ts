import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import bookingRoutes from './routes/booking.routes';
import webhookRoutes from './routes/webhook.routes';

// تحميل .env لدعم بيئة Render السحابية (/etc/secrets/.env)
if (fs.existsSync('/etc/secrets/.env')) {
  dotenv.config({ path: '/etc/secrets/.env' });
}
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// الميدلوير الأساسي
app.use(cors());
app.use(express.json());

// 1️⃣ تفعيل مجلد الـ Static لخدمة واجهة الاختبار التفاعلية
const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));

// 2️⃣ إضافة مسار صريح للصفحة الرئيسية لضمان فتح index.html مباشرة
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// 3️⃣ تسجيل مسارات الحجز والويب هوك (كلتا البادئتين للضمان)
app.use('/api/bookings', bookingRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/webhook', webhookRoutes);

// مسار فحص الصحة (Health Check)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    verifyTokenConfigured: Boolean(process.env.WEBHOOK_VERIFY_TOKEN),
  });
});

// تشغيل الخادم
app.listen(PORT, () => {
  console.log(`🚀 Sijil Express Server is running on port ${PORT}`);
  console.log(`💻 Interactive Test Dashboard: http://localhost:${PORT}/`);
  console.log(`📲 WhatsApp Webhook URL: http://localhost:${PORT}/api/webhook/whatsapp`);
  console.log(`📡 Health Check URL: http://localhost:${PORT}/health`);
  console.log(`📅 Bookings API Base URL: http://localhost:${PORT}/api/bookings`);
  console.log(`🔑 WEBHOOK_VERIFY_TOKEN status: ${process.env.WEBHOOK_VERIFY_TOKEN ? 'CONFIGURED ✅' : 'MISSING ❌'}`);
});
