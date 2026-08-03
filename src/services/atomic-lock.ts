/**
 * Atomic Block Guard
 * Prevents race-conditions & double-bookings under concurrent requests.
 * Each lock records an optional owner; the owning session may re-acquire/renew its own lock,
 * while a DIFFERENT owner is always rejected (no double-booking, no lock-stealing).
 */
interface LockEntry {
  expiresAt: number;
  owner?: string;
}

export class AtomicLockManager {
  private static locks: Map<string, LockEntry> = new Map();

  /**
   * Attempt to acquire an atomic lock for a resource (e.g., doctorId + slotDate + slotTime)
   * @param resourceKey Unique string representing the slot
   * @param ttlMs Time-to-live for the lock in milliseconds (default 10 minutes)
   * @param owner Session/patient identifier that requested the lock
   */
  public static acquireLock(resourceKey: string, ttlMs: number = 600000, owner?: string): boolean {
    const now = Date.now();
    const existingLock = this.locks.get(resourceKey);

    if (existingLock && existingLock.expiresAt > now) {
      // Lock is still active -> allow ONLY the same owner to extend it (idempotent re-proposal)
      if (owner && existingLock.owner === owner) {
        existingLock.expiresAt = now + ttlMs;
        return true;
      }
      return false;
    }

    // Acquire lock
    this.locks.set(resourceKey, { expiresAt: now + ttlMs, owner });
    return true;
  }

  /**
   * Release an acquired atomic lock
   */
  public static releaseLock(resourceKey: string): void {
    this.locks.delete(resourceKey);
  }

  /**
   * Renew/extend the TTL of an existing lock (used by the session that originally proposed the slot
   * right before the final booking write to keep the reservation fresh).
   * Never steals a lock held by a different owner.
   */
  public static renewLock(resourceKey: string, ttlMs: number = 600000, owner?: string): boolean {
    const now = Date.now();
    const existingLock = this.locks.get(resourceKey);
    if (existingLock && existingLock.expiresAt > now && owner && existingLock.owner && existingLock.owner !== owner) {
      // Held by another session -> do not steal
      return false;
    }
    this.locks.set(resourceKey, { expiresAt: now + ttlMs, owner: owner || existingLock?.owner });
    return true;
  }

  /**
   * Check if resource is currently locked
   */
  public static isLocked(resourceKey: string): boolean {
    const lock = this.locks.get(resourceKey);
    if (!lock) return false;
    if (lock.expiresAt <= Date.now()) {
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
    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }
}
