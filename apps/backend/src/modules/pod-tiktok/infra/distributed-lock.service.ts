import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../../redis/redis.service';

/** Lock đã giành được — giữ `fenceToken` để giải phóng an toàn. */
export interface AcquiredLock {
  key: string;
  fenceToken: string;
}

/**
 * DistributedLockService — khoá phân tán trên Redis.
 *
 * Vì sao bắt buộc: `@nestjs/schedule` chạy cron trên **mọi instance** của API.
 * Không có khoá thì nhiều instance sẽ cùng đồng bộ một shop ⇒ gọi TikTok gấp đôi
 * (đốt quota) và tạo race khi ghi DB.
 *
 * Giải phóng dùng **fencing token** + Lua script: chỉ xoá khi giá trị còn đúng của mình.
 * `DEL` mù có thể xoá nhầm khoá mà instance khác vừa giành được sau khi khoá của
 * mình đã hết hạn.
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

  /** Chỉ xoá khi value khớp fence token (atomic). */
  private static readonly RELEASE_SCRIPT = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end`;

  /** Chỉ gia hạn khi value khớp fence token (atomic). */
  private static readonly RENEW_SCRIPT = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("PEXPIRE", KEYS[1], ARGV[2])
    else
      return 0
    end`;

  constructor(private readonly redis: RedisService) {}

  /** Giành khoá. Trả `null` nếu đã có tiến trình khác giữ. */
  async acquire(key: string, ttlMs: number): Promise<AcquiredLock | null> {
    const fenceToken = randomUUID();
    const result = await this.redis.client.set(key, fenceToken, 'PX', ttlMs, 'NX');
    return result === 'OK' ? { key, fenceToken } : null;
  }

  /** Giải phóng khoá (an toàn với fencing token). */
  async release(lock: AcquiredLock): Promise<void> {
    try {
      await this.redis.client.eval(
        DistributedLockService.RELEASE_SCRIPT,
        1,
        lock.key,
        lock.fenceToken,
      );
    } catch (error) {
      // Không ném lỗi: khoá sẽ tự hết hạn theo TTL.
      this.logger.warn(`Không giải phóng được khoá ${lock.key}: ${(error as Error).message}`);
    }
  }

  /** Gia hạn khoá cho tác vụ chạy dài (watchdog). */
  async renew(lock: AcquiredLock, ttlMs: number): Promise<boolean> {
    const result = await this.redis.client.eval(
      DistributedLockService.RENEW_SCRIPT,
      1,
      lock.key,
      lock.fenceToken,
      String(ttlMs),
    );
    return result === 1;
  }

  /**
   * Chạy `task` trong phạm vi khoá; nếu không giành được khoá trả `null`.
   * Luôn giải phóng khoá kể cả khi `task` ném lỗi.
   */
  async withLock<T>(key: string, ttlMs: number, task: () => Promise<T>): Promise<T | null> {
    const lock = await this.acquire(key, ttlMs);
    if (!lock) return null;
    try {
      return await task();
    } finally {
      await this.release(lock);
    }
  }
}
