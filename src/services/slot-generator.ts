import { TimeSlot, Doctor, BookedSlot } from '../types/booking.js';
import { AtomicLockManager } from './atomic-lock.js';
import { getBaghdadNow, addDays, formatDate } from '../utils/baghdad-time.js';

interface BreakInterval {
  startMinute: number;
  endMinute: number;
}

export class SlotGenerator {
  /**
   * Helper to get Tomorrow's Date (YYYY-MM-DD) for Tomorrow-First slot generation
   */
  public static getTomorrowDate(): string {
    return formatDate(addDays(getBaghdadNow(), 1));
  }

  /**
   * Parse break times text (e.g. "13:00-14:00" or "13:00 - 14:00, 17:00 - 18:00")
   */
  private static parseBreakTimes(breakTimesStr?: string): BreakInterval[] {
    if (!breakTimesStr || !breakTimesStr.trim()) return [];
    const intervals: BreakInterval[] = [];
    const parts = breakTimesStr.split(/[,،;]/);
    for (const part of parts) {
      const m = part.match(/(\d{1,2}):?(\d{2})?\s*[-–—]\s*(\d{1,2}):?(\d{2})?/);
      if (m) {
        const startMinute = parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0);
        const endMinute = parseInt(m[3]) * 60 + (m[4] ? parseInt(m[4]) : 0);
        if (endMinute > startMinute) intervals.push({ startMinute, endMinute });
      }
    }
    return intervals;
  }

  /**
   * OffDays entries may be specific dates ("2026-08-15") or Arabic weekday names ("الجمعة").
   * Returns true if the given date/weekday is off.
   */
  public static isOffDay(doctor: Doctor, date: string, dayOfWeek: number): boolean {
    if (!doctor.offDays || doctor.offDays.length === 0) return false;
    const dayMap: Record<string, number> = {
      'أحد': 0, 'الاحد': 0, 'الأحد': 0, 'sun': 0,
      'إثنين': 1, 'اثنين': 1, 'الإثنين': 1, 'mon': 1,
      'ثلاثاء': 2, 'الثلاثاء': 2, 'tue': 2,
      'أربعاء': 3, 'اربعاء': 3, 'الأربعاء': 3, 'wed': 3,
      'خميس': 4, 'الخميس': 4, 'thu': 4,
      'جمعة': 5, 'الجمعة': 5, 'fri': 5,
      'سبت': 6, 'السبت': 6, 'sat': 6
    };
    return doctor.offDays.some(entry => {
      const e = entry.trim().toLowerCase();
      if (/^\d{4}-\d{2}-\d{2}$/.test(e)) return e === date;
      for (const [key, num] of Object.entries(dayMap)) {
        if (e === key.toLowerCase() && num === dayOfWeek) return true;
      }
      return false;
    });
  }

  /**
   * Check if an interval [slotStart, slotEnd) intersects a break interval
   */
  private static intersectsBreak(slotStart: number, slotEnd: number, breaks: BreakInterval[]): boolean {
    return breaks.some(b => slotStart < b.endMinute && slotEnd > b.startMinute);
  }

  /**
   * Check if an interval [slotStart, slotEnd) overlaps any existing booking interval
   */
  private static overlapsBooking(
    slotStart: number,
    slotEnd: number,
    doctor: Doctor,
    date: string,
    bookings: Array<{ doctorId?: string; doctorName?: string; date: string; startTime: string; endTime: string }>
  ): boolean {
    const toMin = (t: string): number => {
      const [h, m] = t.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    return bookings.some(b => {
      if (b.date !== date) return false;
      const sameDoctor =
        (b.doctorId && b.doctorId === doctor.id) ||
        (b.doctorName && (b.doctorName === doctor.name || doctor.name.includes(b.doctorName) || b.doctorName.includes(doctor.name)));
      if (!sameDoctor) return false;
      const bStart = toMin(b.startTime);
      const bEnd = b.endTime ? toMin(b.endTime) : bStart + 30;
      return slotStart < bEnd && slotEnd > bStart;
    });
  }

  /**
   * Generate available time slots for a doctor starting from tomorrow or specific date (YYYY-MM-DD).
   * Applies 1.2x Human Buffer Multiplier, excludes BreakTimes / OffDays / existing bookings / locked slots,
   * and enforces DailyPatientCapacity.
   */
  public static generateAvailableSlots(
    doctor: Doctor,
    date: string,
    existingBookings: Array<{ doctorId?: string; doctorName?: string; date: string; startTime: string; endTime: string }> = [],
    serviceDurationMinutes: number = 30,
    ignoreLockedSlotId?: string
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay();

    // Check if doctor works on this day
    if (!doctor.workingHours.days.includes(dayOfWeek)) {
      return slots; // No slots on non-working days
    }

    // Check OffDays (specific dates OR Arabic weekday names)
    if (this.isOffDay(doctor, date, dayOfWeek)) {
      return slots;
    }

    const { startHour, endHour, slotDurationMinutes } = doctor.workingHours;

    // Apply 1.2x Human Buffer Multiplier to service duration (e.g. 30 mins * 1.2 = 36 mins)
    const effectiveDuration = Math.ceil((serviceDurationMinutes || slotDurationMinutes) * 1.2);

    const breaks = this.parseBreakTimes(doctor.breakTimes);

    // DailyPatientCapacity enforcement: remaining capacity = capacity - already booked count for this doctor+date
    const capacity = doctor.dailyPatientCapacity || 20;
    const bookedCount = existingBookings.filter(
      b => b.date === date && ((b.doctorId && b.doctorId === doctor.id) || (b.doctorName && (b.doctorName === doctor.name || doctor.name.includes(b.doctorName) || b.doctorName.includes(doctor.name))))
    ).length;
    const remainingCapacity = Math.max(0, capacity - bookedCount);

    let currentMinute = startHour * 60;
    const endMinute = endHour * 60;

    while (currentMinute + effectiveDuration <= endMinute && slots.length < remainingCapacity) {
      const startH = Math.floor(currentMinute / 60).toString().padStart(2, '0');
      const startM = (currentMinute % 60).toString().padStart(2, '0');

      const endSlotMinute = currentMinute + effectiveDuration;
      const endH = Math.floor(endSlotMinute / 60).toString().padStart(2, '0');
      const endM = (endSlotMinute % 60).toString().padStart(2, '0');

      const startTime = `${startH}:${startM}`;
      const endTime = `${endH}:${endM}`;

      const slotKey = `${doctor.id}_${date}_${startTime}`;

      // Skip slots that fall inside break times
      const inBreak = this.intersectsBreak(currentMinute, endSlotMinute, breaks);

      // Check if slot overlaps any existing booking or is locked atomically
      const isAlreadyBooked = this.overlapsBooking(currentMinute, endSlotMinute, doctor, date, existingBookings);

      // Ignore the caller's own lock (e.g. final commit re-check), but NOT other sessions' locks
      const isLocked = ignoreLockedSlotId === slotKey ? false : AtomicLockManager.isLocked(slotKey);

      if (!inBreak && !isAlreadyBooked && !isLocked) {
        slots.push({
          slotId: slotKey,
          doctorId: doctor.id,
          doctorName: doctor.name,
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
   * Check if a [startMinute, endMinute) interval falls inside the doctor's break times
   */
  public static isTimeInBreak(doctor: Doctor, startMinute: number, endMinute: number): boolean {
    return this.intersectsBreak(startMinute, endMinute, this.parseBreakTimes(doctor.breakTimes));
  }

  /**
   * Lock a temporary slot for 10 minutes during patient confirmation
   */
  public static lockSlotTemporarily(slot: TimeSlot, ttlMs: number = 600000, owner?: string): boolean {
    return AtomicLockManager.acquireLock(slot.slotId, ttlMs, owner);
  }

  /**
   * Renew the lock for a slot already held by the same session (used right before final booking write)
   */
  public static renewSlotLock(slot: TimeSlot, ttlMs: number = 600000, owner?: string): boolean {
    return AtomicLockManager.renewLock(slot.slotId, ttlMs, owner);
  }

  /**
   * Release temporary slot lock if patient cancels or changes mind
   */
  public static unlockSlot(slot: TimeSlot): void {
    AtomicLockManager.releaseLock(slot.slotId);
  }
}
