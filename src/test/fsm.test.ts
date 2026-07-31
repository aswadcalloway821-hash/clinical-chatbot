import assert from 'node:assert';
import { describe, it } from 'node:test';
import { AtomicLockManager } from '../services/atomic-lock.js';
import { SlotGenerator } from '../services/slot-generator.js';
import { Doctor } from '../types/booking.js';

describe('Atomic Lock Guard & Slot Generator', () => {
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

  it('should generate available slots for doctor working hours', () => {
    const mockDoctor: Doctor = {
      id: 'doc_1',
      branchId: 'b1',
      name: 'د. علي',
      specialty: 'عام',
      services: ['s1'],
      workingHours: {
        days: [0, 1, 2, 3, 4, 5, 6], // All days
        startHour: 10,
        endHour: 12,
        slotDurationMinutes: 30
      }
    };

    const slots = SlotGenerator.generateAvailableSlots(mockDoctor, '2026-08-01', []);
    assert.strictEqual(slots.length, 4, 'Should generate 4 slots (10:00, 10:30, 11:00, 11:30)');
    assert.strictEqual(slots[0].startTime, '10:00');
    assert.strictEqual(slots[3].startTime, '11:30');
  });
});
