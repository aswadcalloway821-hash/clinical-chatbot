import { TimeSlot, Doctor } from '../types/booking.js';
import { AtomicLockManager } from './atomic-lock.js';

export class SlotGenerator {
  /**
   * Helper to get Tomorrow's Date (YYYY-MM-DD) for Tomorrow-First slot generation
   */
  public static getTomorrowDate(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }

  /**
   * Generate available time slots for a doctor starting from tomorrow or specific date (YYYY-MM-DD).
   * Applies 1.2x Human Buffer Multiplier for realistic operational margin.
   */
  public static generateAvailableSlots(
    doctor: Doctor,
    date: string,
    existingBookings: Array<{ date: string; startTime: string; doctorId: string }>,
    serviceDurationMinutes: number = 30
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay();

    // Check if doctor works on this day
    if (!doctor.workingHours.days.includes(dayOfWeek)) {
      return slots; // No slots on non-working days
    }

    const { startHour, endHour, slotDurationMinutes } = doctor.workingHours;
    
    // Apply 1.2x Human Buffer Multiplier to service duration (e.g. 30 mins * 1.2 = 36 mins)
    const effectiveDuration = Math.ceil((serviceDurationMinutes || slotDurationMinutes) * 1.2);

    let currentMinute = startHour * 60;
    const endMinute = endHour * 60;

    while (currentMinute + effectiveDuration <= endMinute) {
      const startH = Math.floor(currentMinute / 60).toString().padStart(2, '0');
      const startM = (currentMinute % 60).toString().padStart(2, '0');

      const endSlotMinute = currentMinute + effectiveDuration;
      const endH = Math.floor(endSlotMinute / 60).toString().padStart(2, '0');
      const endM = (endSlotMinute % 60).toString().padStart(2, '0');

      const startTime = `${startH}:${startM}`;
      const endTime = `${endH}:${endM}`;

      const slotKey = `${doctor.id}_${date}_${startTime}`;

      // Check if slot is already booked or locked atomically
      const isAlreadyBooked = existingBookings.some(
        b => b.doctorId === doctor.id && b.date === date && b.startTime === startTime
      );

      const isLocked = AtomicLockManager.isLocked(slotKey);

      if (!isAlreadyBooked && !isLocked) {
        slots.push({
          slotId: slotKey,
          doctorId: doctor.id,
          date,
          startTime,
          endTime,
          isLocked: false
        });
      }

      // Increment by effective duration with buffer
      currentMinute += effectiveDuration;
    }

    return slots;
  }

  /**
   * Lock a temporary slot for 10 minutes during patient confirmation
   */
  public static lockSlotTemporarily(slot: TimeSlot, ttlMs: number = 600000): boolean {
    return AtomicLockManager.acquireLock(slot.slotId, ttlMs);
  }

  /**
   * Release temporary slot lock if patient cancels or changes mind
   */
  public static unlockSlot(slot: TimeSlot): void {
    AtomicLockManager.releaseLock(slot.slotId);
  }
}
