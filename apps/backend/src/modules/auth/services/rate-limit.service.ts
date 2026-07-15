import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';

export interface RateLimitResult {
  /** Số lần đã đếm trong cửa sổ hiện tại. */
  count: number;
  /** true nếu count đã VƯỢT limit. */
  limited: boolean;
}

/**
 * RateLimitService — bộ đếm chống lạm dụng dựa trên Redis (fixed window).
 *
 * Dùng cho:
 *   - Rate limit request login: 5/phút/IP (Decision-005).
 *   - Bộ đếm đăng nhập sai theo (email + IP), TTL 15' (Decision-004, BR-L07).
 *
 * Redis chỉ là hạ tầng đếm ephemeral (ADR-006: Redis là Cache/ephemeral).
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Tăng bộ đếm cho `key` trong cửa sổ `windowSeconds`.
   * Đặt TTL ở lần tăng đầu tiên (fixed window). Trả về count + cờ vượt limit.
   */
  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, windowSeconds);
    }
    return { count, limited: count > limit };
  }

  /** Xóa bộ đếm (ví dụ khi login thành công → reset chuỗi sai). */
  async reset(key: string): Promise<void> {
    await this.redis.client.del(key);
  }
}
