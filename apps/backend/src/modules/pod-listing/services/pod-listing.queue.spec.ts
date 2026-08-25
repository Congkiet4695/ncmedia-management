import { computeRetryDelayMs, runWithConcurrency } from './pod-listing.queue';

describe('runWithConcurrency', () => {
  it('chạy đúng số việc song song đã cho, không hơn', async () => {
    let inFlight = 0;
    let peak = 0;

    const tasks = Array.from({ length: 20 }, () => async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return 1;
    });

    const outcomes = await runWithConcurrency(tasks, 5);

    expect(peak).toBe(5);
    expect(outcomes).toHaveLength(20);
    expect(outcomes.every((outcome) => outcome.value === 1)).toBe(true);
  });

  it('giữ nguyên thứ tự kết quả theo thứ tự việc, dù việc xong lệch nhau', async () => {
    const tasks = [30, 5, 20, 1].map((ms, index) => async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return index;
    });

    const outcomes = await runWithConcurrency(tasks, 4);

    expect(outcomes.map((outcome) => outcome.value)).toEqual([0, 1, 2, 3]);
  });

  it('một việc hỏng KHÔNG làm hỏng cả lượt (fail-soft)', async () => {
    const tasks = [
      () => Promise.resolve('ok-1'),
      () => Promise.reject(new Error('bùm')),
      () => Promise.resolve('ok-2'),
    ];

    const outcomes = await runWithConcurrency(tasks, 2);

    expect(outcomes[0].value).toBe('ok-1');
    expect((outcomes[1].error as Error).message).toBe('bùm');
    expect(outcomes[2].value).toBe('ok-2');
  });

  it('gọi onSettled ngay khi từng việc xong (để cập nhật tiến độ)', async () => {
    const seen: number[] = [];
    const tasks = [3, 1, 2].map((ms, index) => async () => {
      await new Promise((resolve) => setTimeout(resolve, ms * 10));
      return index;
    });

    await runWithConcurrency(tasks, 3, (outcome) => {
      seen.push(outcome.value as number);
    });

    // Xong sớm báo trước — không đợi cả lượt kết thúc mới báo một thể.
    expect(seen).toEqual([1, 2, 0]);
  });

  it('concurrency lớn hơn số việc thì không sinh worker thừa', async () => {
    const outcomes = await runWithConcurrency([() => Promise.resolve('x')], 10);
    expect(outcomes).toHaveLength(1);
  });
});

describe('computeRetryDelayMs', () => {
  it('nhân đôi sau mỗi lần thử (exponential backoff)', () => {
    expect(computeRetryDelayMs(1, 2_000, 60_000)).toBe(2_000);
    expect(computeRetryDelayMs(2, 2_000, 60_000)).toBe(4_000);
    expect(computeRetryDelayMs(3, 2_000, 60_000)).toBe(8_000);
  });

  it('không vượt trần', () => {
    expect(computeRetryDelayMs(20, 2_000, 60_000)).toBe(60_000);
  });

  it('lần chạy đầu không chờ', () => {
    expect(computeRetryDelayMs(0, 2_000, 60_000)).toBe(0);
  });
});
