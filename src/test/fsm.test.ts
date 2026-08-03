import assert from 'node:assert';
import { describe, it } from 'node:test';
import { AtomicLockManager } from '../services/atomic-lock.js';
import { SlotGenerator } from '../services/slot-generator.js';
import { DynamicSlotEngine } from '../core/dynamic-slot-engine.js';
import { Doctor, BookedSlot } from '../types/booking.js';

const mockDoctor: Doctor = {
  id: 'doc_1',
  branchId: 'b1',
  branchName: 'الكرادة',
  name: 'د. علي',
  specialty: 'عام',
  services: ['s1'],
  calendarId: 'primary',
  dailyPatientCapacity: 20,
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  workingHours: {
    days: [0, 1, 2, 3, 4, 5, 6],
    startHour: 10,
    endHour: 12,
    slotDurationMinutes: 30
  }
};

describe('Atomic Lock Guard & Slot Generator with 1.2x Human Buffer', () => {
  it('should lock resource atomically and prevent double lock', () => {
    const slotKey = 'doctor_1_2026-08-01_10:00';
    const firstLock = AtomicLockManager.acquireLock(slotKey, 60000);
    assert.strictEqual(firstLock, true, 'First lock attempt should succeed');

    const secondLock = AtomicLockManager.acquireLock(slotKey, 60000);
    assert.strictEqual(secondLock, false, 'Second lock attempt on same slot must fail');

    AtomicLockManager.releaseLock(slotKey);
    const lockAfterRelease = AtomicLockManager.acquireLock(slotKey, 60000);
    assert.strictEqual(lockAfterRelease, true, 'Lock after release should succeed');
    AtomicLockManager.releaseLock(slotKey);
  });

  it('should renew an existing lock without breaking atomicity', () => {
    const slotKey = 'doctor_1_2026-08-01_11:00';
    assert.strictEqual(AtomicLockManager.acquireLock(slotKey, 60000), true);
    assert.strictEqual(AtomicLockManager.renewLock(slotKey, 60000), true, 'Renew of own lock should succeed');
    assert.strictEqual(AtomicLockManager.isLocked(slotKey), true, 'Lock stays active after renew');
    AtomicLockManager.releaseLock(slotKey);
  });

  it('should allow the SAME owner to re-acquire its own lock (idempotent re-proposal)', () => {
    const slotKey = 'doctor_1_2026-08-01_12:00';
    assert.strictEqual(AtomicLockManager.acquireLock(slotKey, 60000, '07700000111'), true);
    assert.strictEqual(AtomicLockManager.acquireLock(slotKey, 60000, '07700000111'), true, 'Same owner re-acquire must succeed');
    AtomicLockManager.releaseLock(slotKey);
  });

  it('should REJECT a different owner attempting to take a locked slot', () => {
    const slotKey = 'doctor_1_2026-08-01_12:30';
    assert.strictEqual(AtomicLockManager.acquireLock(slotKey, 60000, '07700000111'), true);
    assert.strictEqual(AtomicLockManager.acquireLock(slotKey, 60000, '07799999999'), false, 'Different owner must be rejected');
    assert.strictEqual(AtomicLockManager.renewLock(slotKey, 60000, '07799999999'), false, 'Different owner must never renew/steal');
    AtomicLockManager.releaseLock(slotKey);
  });

  it('should generate available slots with 1.2x human buffer multiplier', () => {
    // 120 mins available / 36 mins per slot = 3 slots (10:00, 10:36, 11:12)
    const slots = SlotGenerator.generateAvailableSlots(mockDoctor, '2026-08-01', []);
    assert.strictEqual(slots.length, 3, 'Should generate 3 slots with 1.2x buffer (36 mins each)');
    assert.strictEqual(slots[0].startTime, '10:00');
    assert.strictEqual(slots[0].endTime, '10:36');
    assert.strictEqual(slots[1].startTime, '10:36');
    assert.strictEqual(slots[2].startTime, '11:12');
  });

  it('should EXCLUDE slots that overlap existing live bookings (no double-booking)', () => {
    const booked: BookedSlot[] = [{
      bookingCode: 'BK-11111',
      doctorName: 'د. علي',
      date: '2026-08-01',
      startTime: '10:36',
      endTime: '11:12',
      status: 'CONFIRMED',
      patientPhone: '07700000001'
    }];
    const slots = SlotGenerator.generateAvailableSlots(mockDoctor, '2026-08-01', booked);
    const times = slots.map(s => s.startTime);
    assert.deepStrictEqual(times, ['10:00', '11:12'], 'Booked 10:36-11:12 slot must be excluded, remaining: 10:00, 11:12');
  });

  it('should EXCLUDE slots falling inside BreakTimes', () => {
    const doc: Doctor = { ...mockDoctor, breakTimes: '10:36-11:00' };
    const slots = SlotGenerator.generateAvailableSlots(doc, '2026-08-01', []);
    const times = slots.map(s => s.startTime);
    assert.deepStrictEqual(times, ['10:00', '11:12'], 'Slot overlapping break 10:36-11:00 must be excluded');
  });

  it('should EXCLUDE all slots on OffDays dates', () => {
    const doc: Doctor = { ...mockDoctor, offDays: ['2026-08-01'] };
    const slots = SlotGenerator.generateAvailableSlots(doc, '2026-08-01', []);
    assert.strictEqual(slots.length, 0, 'No slots should exist on an off-day');
  });

  it('should enforce DailyPatientCapacity minus already-booked count', () => {
    const doc: Doctor = { ...mockDoctor, dailyPatientCapacity: 2 };
    const booked: BookedSlot[] = [{
      bookingCode: 'BK-22222',
      doctorName: 'د. علي',
      date: '2026-08-01',
      startTime: '10:00',
      endTime: '10:36',
      status: 'CONFIRMED',
      patientPhone: '07700000002'
    }];
    // capacity 2, 1 already booked -> only 1 more slot allowed (10:36)
    const slots = SlotGenerator.generateAvailableSlots(doc, '2026-08-01', booked);
    assert.deepStrictEqual(slots.map(s => s.startTime), ['10:36'], 'Only 1 remaining slot of capacity 2 after 1 booking');
  });

  it('should format 12-hour working hours comfortably', () => {
    const formatted = DynamicSlotEngine.formatWorkingHours(9, 16);
    assert.strictEqual(formatted, '9 صباحاً لغاية 4 عصراً');
  });

  it('should calculate tomorrow date in Asia/Baghdad timezone', () => {
    const tomorrowStr = SlotGenerator.getTomorrowDate();
    assert.match(tomorrowStr, /^\d{4}-\d{2}-\d{2}$/);
  });
});
