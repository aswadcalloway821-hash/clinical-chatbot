/**
 * Atomic Block Guard
 * Prevents race-conditions & double-bookings under concurrent requests
 */
export class AtomicLockManager {
  private static locks: Map<string, number> = new Map();

  /**
   * Attempt to acquire an atomic lock for a resource (e.g., doctorId + slotDate + slotTime)
   * @param resourceKey Unique string representing the slot
   * @param ttlMs Time-to-live for the lock in milliseconds (default 10 minutes)
   */
  public static acquireLock(resourceKey: string, ttlMs: number = 600000): boolean {
    const now = Date.now();
    const existingLock = this.locks.get(resourceKey);

    if (existingLock && existingLock > now) {
      // Lock is still active and valid -> reject duplicate booking attempt
      return false;
    }

    // Acquire lock
    this.locks.set(resourceKey, now + ttlMs);
    return true;
  }

  /**
   * Release an acquired atomic lock
   */
  public static releaseLock(resourceKey: string): void {
    this.locks.delete(resourceKey);
  }

  /**
   * Check if resource is currently locked
   */
  public static isLocked(resourceKey: string): boolean {
    const lockTime = this.locks.get(resourceKey);
    if (!lockTime) return false;
    if (lockTime <= Date.now()) {
      this.locks.delete(resourceKey);
      return false;
    }
    return true;
  }

  /**
   * Clean expired locks periodically
   */
  public static cleanExpiredLocks(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.locks.entries()) {
      if (expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }
}
