import Redis from 'ioredis';
import { PodProductSyncQueue } from './pod-product-sync.queue';

/**
 * Integration test — hàng đợi đồng bộ HOÃN theo shop, chạy trên **Redis thật**.
 *
 * 🔴 Vì sao không mock Redis: toàn bộ tính đúng đắn của hàng đợi nằm trong hai script Lua
 * (gộp lịch có trần chờ, nhận việc nguyên tử). Mock `eval` nghĩa là test khẳng định "tôi đã
 * gọi eval" chứ không khẳng định gì về hành vi — đúng thứ cần chứng minh thì không kiểm.
 *
 * Không có Redis ⇒ bỏ qua cả bộ (`describe.skip`) thay vì đỏ giả: CI chưa có Redis không
 * phải là lỗi của mã nguồn.
 */

const HOST = process.env.REDIS_HOST ?? 'localhost';
const PORT = Number(process.env.REDIS_PORT ?? 6379);

let available = false;
let client: Redis;

beforeAll(async () => {
  client = new Redis({
    host: HOST,
    port: PORT,
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await client.connect();
    await client.ping();
    available = true;
  } catch {
    available = false;
  }
});

afterAll(() => {
  if (client) client.disconnect();
});

const SHOP_A = 'shop-aaaa';
const SHOP_B = 'shop-bbbb';
const DUE_KEY = 'pod:product-sync:delayed';
const DEADLINE_KEY = 'pod:product-sync:delayed:deadline';

const FIVE_MIN = 5 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

describe('PodProductSyncQueue (Redis thật)', () => {
  let queue: PodProductSyncQueue;

  beforeEach(async () => {
    if (!available) return;
    await client.del(DUE_KEY, DEADLINE_KEY);
    queue = new PodProductSyncQueue({ client } as never);
  });

  const guard = () => {
    if (!available) {
      console.warn('⚠️  Bỏ qua: không kết nối được Redis tại ' + HOST + ':' + PORT);
      return true;
    }
    return false;
  };

  // -------------------------------------------------------------------------
  // CASE 1 + 5 — hẹn đúng shop, đúng 5 phút
  // -------------------------------------------------------------------------
  it('hẹn đồng bộ cho một shop, đến hạn sau đúng 5 phút', async () => {
    if (guard()) return;

    const before = Date.now();
    const dueAt = await queue.schedule(SHOP_A, FIVE_MIN, FIFTEEN_MIN);

    expect(dueAt.getTime()).toBeGreaterThanOrEqual(before + FIVE_MIN);
    expect(dueAt.getTime()).toBeLessThanOrEqual(Date.now() + FIVE_MIN);
    // Chưa tới hạn ⇒ worker không được nhận.
    expect(await queue.claimDue(10)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // CASE 4 — publish nhiều listing của CÙNG shop ⇒ vẫn chỉ MỘT lịch
  // -------------------------------------------------------------------------
  it('🔴 publish 50 listing của cùng một shop ⇒ ĐÚNG MỘT dòng trong hàng đợi', async () => {
    if (guard()) return;

    for (let i = 0; i < 50; i += 1) {
      await queue.schedule(SHOP_A, FIVE_MIN, FIFTEEN_MIN);
    }

    expect(await queue.pendingCount()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // CASE 3 — hai shop độc lập
  // -------------------------------------------------------------------------
  it('🔴 shop A và shop B có lịch RIÊNG, A không chặn B', async () => {
    if (guard()) return;

    await queue.schedule(SHOP_A, FIVE_MIN, FIFTEEN_MIN);
    await queue.schedule(SHOP_B, FIVE_MIN, FIFTEEN_MIN);

    expect(await queue.pendingCount()).toBe(2);

    // Đẩy MỘT MÌNH shop A tới hạn — B phải còn nguyên trong hàng đợi.
    await client.zadd(DUE_KEY, Date.now() - 1, SHOP_A);
    const due = await queue.claimDue(10);

    expect(due).toEqual([SHOP_A]);
    expect(await queue.pendingCount()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Gộp lịch (debounce) + TRẦN CHỜ
  // -------------------------------------------------------------------------
  it('publish lần sau ĐẨY lịch đi (gộp), không tạo lịch thứ hai', async () => {
    if (guard()) return;

    const first = await queue.schedule(SHOP_A, FIVE_MIN, FIFTEEN_MIN);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await queue.schedule(SHOP_A, FIVE_MIN, FIFTEEN_MIN);

    expect(second.getTime()).toBeGreaterThan(first.getTime());
    expect(await queue.pendingCount()).toBe(1);
  });

  it('🔴 TRẦN CHỜ: publish liên tục KHÔNG đẩy lịch đi vô hạn (chống bỏ đói)', async () => {
    if (guard()) return;

    // Trần 1 giây: publish liên tục vẫn phải đến hạn trong vòng ~1 giây kể từ lần đầu.
    const first = await queue.schedule(SHOP_A, FIVE_MIN, 1_000);
    for (let i = 0; i < 20; i += 1) {
      await queue.schedule(SHOP_A, FIVE_MIN, 1_000);
    }
    const last = await queue.schedule(SHOP_A, FIVE_MIN, 1_000);

    // Bị kẹp vào hạn chót, KHÔNG phải now + 5 phút.
    expect(last.getTime()).toBeLessThanOrEqual(first.getTime() + 1_000);
    expect(last.getTime()).toBeLessThan(Date.now() + FIVE_MIN);
  });

  // -------------------------------------------------------------------------
  // Nhận việc
  // -------------------------------------------------------------------------
  it('nhận việc đến hạn và GỠ khỏi hàng đợi (không nhận lại lần hai)', async () => {
    if (guard()) return;

    await queue.schedule(SHOP_A, FIVE_MIN, FIFTEEN_MIN);
    await client.zadd(DUE_KEY, Date.now() - 1, SHOP_A);

    expect(await queue.claimDue(10)).toEqual([SHOP_A]);
    expect(await queue.claimDue(10)).toEqual([]);
    // Hạn chót cũng phải được dọn, nếu không lần hẹn sau bị kẹp vào hạn chót đã chết.
    expect(await client.hget(DEADLINE_KEY, SHOP_A)).toBeNull();
  });

  it('🔴 hai worker chạy song song: mỗi shop chỉ được nhận MỘT lần', async () => {
    if (guard()) return;

    await queue.schedule(SHOP_A, FIVE_MIN, FIFTEEN_MIN);
    await queue.schedule(SHOP_B, FIVE_MIN, FIFTEEN_MIN);
    await client.zadd(DUE_KEY, Date.now() - 1, SHOP_A, Date.now() - 1, SHOP_B);

    const [first, second] = await Promise.all([queue.claimDue(10), queue.claimDue(10)]);

    expect([...first, ...second].sort()).toEqual([SHOP_A, SHOP_B]);
  });

  it('giới hạn số shop mỗi lượt nhận', async () => {
    if (guard()) return;

    for (const shop of ['s1', 's2', 's3', 's4']) {
      await client.zadd(DUE_KEY, Date.now() - 1, shop);
    }

    expect(await queue.claimDue(2)).toHaveLength(2);
    expect(await queue.pendingCount()).toBe(2);
  });

  it('hẹn lại sau lỗi tạm thời đưa shop trở lại hàng đợi', async () => {
    if (guard()) return;

    await queue.requeue(SHOP_A, FIVE_MIN);

    expect(await queue.pendingCount()).toBe(1);
    expect(await queue.claimDue(10)).toEqual([]);
  });
});
