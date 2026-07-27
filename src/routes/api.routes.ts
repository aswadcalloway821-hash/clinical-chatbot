import { Router } from 'express';
import webhookRoutes from './webhook.routes';
import bookingRoutes from './booking.routes';

const router = Router();

router.use('/webhook', webhookRoutes);
router.use('/bookings', bookingRoutes);

export default router;
