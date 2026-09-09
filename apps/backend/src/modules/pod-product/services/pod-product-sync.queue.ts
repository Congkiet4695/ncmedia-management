import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';

/** ZSET: `member = shopId`, `score = thời điểm đến hạn (epoch ms)`. */
const DUE_KEY = 'pod:product-sync:delayed';
/** HASH: `field = shopId`, `value = hạn chót tuyệt đối (epoch ms)` — trần chống bỏ đói. */
const DEADLINE_KEY = 'pod:product-sync:delayed:deadline';

/**
 * Hoãn có gộp (debounce) + TRẦN CHỜ, nguyên tử trong một lượt Lua.
 *
 * - Chưa có lịch  ⇒ đặt `now + delay`, và chốt hạn chót `now + maxWait`.
 * - Đã có lịch    ⇒ đẩy sang `now + delay` NHƯNG không vượt quá hạn chót đã chốt.
 *
 * Trả về thời điểm đến hạn sau khi tính.
 */
const SCHEDULE_SCRIPT = `
local dueKey, deadlineKey = KEYS[1], KEYS[2]
local shopId, now, delay, maxWait = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local target = now + delay
local deadline = tonumber(redis.call('HGET', deadlineKey, shopId))
if not deadline then
  deadline = now + maxWait
  redis.call('HSET', deadlineKey, shopId, deadline)
end
if target > deadline then target = deadline end
redis.call('ZADD', dueKey, target, shopId)
return target`;

/**
 * Lấy các shop ĐẾN HẠN và gỡ khỏi hàng đợi — nguyên tử, chống hai instance cùng nhận.
 *
 * `ZRANGEBYSCORE` rồi `ZREM` tách rời sẽ để hai worker cùng đọc ra một shop trước khi
 * một trong hai kịp xoá; gộp vào một script là hết cửa đó.
 */
const CLAIM_SCRIPT = `
local dueKey, deadlineKey = KEYS[1], KEYS[2]
local now, limit = tonumber(ARGV[1]), tonumber(ARGV[2])
local shops = redis.call('ZRANGEBYSCORE', dueKey, '-inf', now, 'LIMIT', 0, limit)
if #shops > 0 then
  redis.call('ZREM', dueKey, unpack(shops))
  redis.call('HDEL', deadlineKey, unpack(shops))
end
return shops`;

/**
 * PodProductSyncQueue — hàng đợi **hoãn 5 phút, phạm vi TỪNG SHOP**.
 *
 * 🔴 Vì sao Redis ZSET chứ không phải BullMQ: dự án KHÔNG có BullMQ và không có worker
 * riêng (`pod-listing.queue.ts` ghi rõ điều đó — nó chỉ là bộ giới hạn đồng thời trong tiến
 * trình, không hoãn được). Thêm một hạ tầng hàng đợi mới cho đúng một tính năng là cái giá
 * quá đắt. ZSET với `score = thời điểm đến hạn` chính là cách dựng delayed queue trên Redis,
 * và Redis thì đã có sẵn, đã dùng cho khoá phân tán và cache refresh token.
 *
 * 🔴 Vì sao KHÔNG `setTimeout`: tiến trình API restart là mất sạch lịch, và giữ một request
 * sống 5 phút thì chặn cả OAuth callback lẫn request publish. Lịch nằm ở Redis nên nó sống
 * qua deploy; scheduler đã có sẵn đóng vai worker.
 *
 * 🔴 **`member = shopId` ⇒ chống trùng là bản chất, không phải quy ước.** Một shop publish
 * 50 listing liên tiếp vẫn chỉ có ĐÚNG MỘT dòng trong ZSET. Và vì khoá là shopId, shop A
 * không bao giờ chặn shop B — mỗi shop một dòng độc lập.
 */
@Injectable()
export class PodProductSyncQueue {
  private readonly logger = new Logger(PodProductSyncQueue.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Hẹn đồng bộ cho MỘT shop.
   *
   * `delayMs` — thời gian chờ để TikTok kịp hiển thị listing vừa publish.
   * `maxWaitMs` — trần chờ tuyệt đối. Không có trần thì một shop publish liên tục sẽ đẩy
   * lịch đi mãi và **không bao giờ được đồng bộ**; có trần thì nó vẫn chạy giữa chừng rồi
   * lượt sau chạy tiếp.
   */
  async schedule(shopId: string, delayMs: number, maxWaitMs: number): Promise<Date> {
    const now = Date.now();
    const dueAt = (await this.redis.client.eval(
      SCHEDULE_SCRIPT,
      2,
      DUE_KEY,
      DEADLINE_KEY,
      shopId,
      String(now),
      String(delayMs),
      String(maxWaitMs),
    )) as number;

    return new Date(Number(dueAt));
  }

  /** Nhận các shop đã đến hạn (và gỡ khỏi hàng đợi). Trả mảng rỗng khi chưa có gì. */
  async claimDue(limit: number): Promise<string[]> {
    const shops = (await this.redis.client.eval(
      CLAIM_SCRIPT,
      2,
      DUE_KEY,
      DEADLINE_KEY,
      String(Date.now()),
      String(limit),
    )) as string[];

    return shops ?? [];
  }

  /**
   * Trả shop về hàng đợi khi lượt đồng bộ hỏng vì lý do TẠM THỜI.
   *
   * 🔴 Không dùng cho lỗi uỷ quyền: token chết thì thử lại bao nhiêu lần cũng hỏng, và
   * `PodProductSyncService` đã có bộ đếm lỗi + circuit breaker riêng cho việc đó.
   */
  async requeue(shopId: string, delayMs: number): Promise<void> {
    try {
      await this.redis.client.zadd(DUE_KEY, Date.now() + delayMs, shopId);
    } catch (error) {
      // Mất một lần hẹn lại không đáng để làm hỏng cả tick — lượt theo lịch vẫn sẽ quét tới.
      this.logger.warn({
        module: 'pod-product',
        shopId,
        msg: `Không hẹn lại được lượt đồng bộ: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    }
  }

  /** Số shop đang chờ — dùng cho log vận hành và kiểm chứng. */
  pendingCount(): Promise<number> {
    return this.redis.client.zcard(DUE_KEY);
  }
}
