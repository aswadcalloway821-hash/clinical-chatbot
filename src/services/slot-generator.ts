import { TimeSlot, Doctor } from '../types/booking.js';
import { AtomicLockManager } from './atomic-lock.js';

export class SlotGenerator {
  /**
   * Generate available time slots for a doctor on a specific date (YYYY-MM-DD)
   */
  public static generateAvailableSlots(
    doctor: Doctor,
    date: string,
    existingBookings: Array<{ date: string; startTime: string; doctorId: string }>
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay();

    // Check if doctor works on this day
    if (!doctor.workingHours.days.includes(dayOfWeek)) {
      return slots; // No slots on non-working days
    }

    const { startHour, endHour, slotDurationMinutes } = doctor.workingHours;
    let currentMinute = startHour * 60;
    const endMinute = endHour * 60;

    while (currentMinute + slotDurationMinutes <= endMinute) {
      const startH = Math.floor(currentMinute / 60).toString().padStart(2, '0');
      const startM = (currentMinute % 60).toString().padStart(2, '0');

      const endSlotMinute = currentMinute + slotDurationMinutes;
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

      currentMinute += slotDurationMinutes;
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
