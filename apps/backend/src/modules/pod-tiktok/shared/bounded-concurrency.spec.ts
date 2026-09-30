import { runWithBoundedConcurrency } from './bounded-concurrency';

describe('runWithBoundedConcurrency', () => {
  it('không bao giờ vượt trần song song, và giữ ĐÚNG thứ tự kết quả', async () => {
    let running = 0;
    let peak = 0;
    const results = await runWithBoundedConcurrency([1, 2, 3, 4, 5, 6], { limit: 2 }, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 7 - n));
      running -= 1;
      return n * 10;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(results).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('phần tử CHƯA bắt đầu khi hết hạn ⇒ đi qua onDeadline, không chạy worker', async () => {
    const worker = jest.fn((n: number) => Promise.resolve(`ran-${n}`));

    const results = await runWithBoundedConcurrency(
      [1, 2],
      { limit: 1, deadlineAt: Date.now() - 1, onDeadline: (n) => `deferred-${n}` },
      worker,
    );

    expect(results).toEqual(['deferred-1', 'deferred-2']);
    expect(worker).not.toHaveBeenCalled();
  });

  it('mảng rỗng / trần không hợp lệ ⇒ vẫn an toàn', async () => {
    await expect(runWithBoundedConcurrency([], { limit: 0 }, () => Promise.resolve(1))).resolves.toEqual([]);
    await expect(
      runWithBoundedConcurrency([1, 2], { limit: 0 }, (n) => Promise.resolve(n)),
    ).resolves.toEqual([1, 2]);
  });
});
