import { DataRetentionJob } from './data-retention.job';

/**
 * Lịch retention: TẮT mặc định, cron theo múi giờ nghiệp vụ, MỘT replica mỗi ngày nghiệp vụ.
 */
function build(config: Record<string, unknown> = {}, claimed: Array<boolean> = [true]) {
  const registry = { addCronJob: jest.fn() };
  const options = {
    tasks: ['RECENT_NOTIFICATIONS'],
    dryRun: true,
    timeZone: 'America/Los_Angeles',
  };
  const retention = {
    configuredOptions: jest.fn(() => options),
    run: jest.fn().mockResolvedValue({ tasks: [] }),
  };
  const answers = [...claimed];
  const locks = {
    acquire: jest.fn((key: string) =>
      Promise.resolve(answers.shift() ? { key, fenceToken: 'f' } : null),
    ),
  };
  const configService = {
    get: jest.fn((key: string, fallback: unknown) => (key in config ? config[key] : fallback)),
  };
  const job = new DataRetentionJob(
    configService as never,
    registry as never,
    retention as never,
    locks as never,
  );
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn(job['logger'], level).mockImplementation(() => undefined);
  }
  return { job, registry, retention, locks };
}

describe('DataRetentionJob', () => {
  it('🔴 mặc định TẮT ⇒ không đăng ký cron (deploy không tự xoá dữ liệu)', () => {
    const { job, registry } = build();
    job.onModuleInit();
    expect(registry.addCronJob).not.toHaveBeenCalled();
  });

  it('bật ⇒ đăng ký cron theo MÚI GIỜ NGHIỆP VỤ', () => {
    const { job, registry } = build({
      'dataRetention.enabled': true,
      'dataRetention.cron': '20 0 * * *',
    });
    job.onModuleInit();
    expect(registry.addCronJob).toHaveBeenCalledTimes(1);
    const cron = (registry.addCronJob.mock.calls[0] as unknown[])[1] as {
      cronTime: { timeZone?: string };
      stop: () => void;
    };
    expect(cron.cronTime.timeZone).toBe('America/Los_Angeles');
    cron.stop();
  });

  it('cron sai cú pháp ⇒ không làm sập ứng dụng', () => {
    const { job, registry } = build({
      'dataRetention.enabled': true,
      'dataRetention.cron': 'không phải cron',
    });
    expect(() => job.onModuleInit()).not.toThrow();
    expect(registry.addCronJob).not.toHaveBeenCalled();
  });

  it('🔴 nhiều replica: chỉ replica giành được khoá của NGÀY nghiệp vụ mới chạy', async () => {
    const first = build({}, [true]);
    const second = build({}, [false]);
    const at = new Date('2026-10-30T07:20:00Z'); // 00:20 PDT ngày 30
    await first.job.handleTick(at);
    await second.job.handleTick(at);
    expect(first.locks.acquire).toHaveBeenCalledWith(
      'data-retention:tick:2026-10-30',
      expect.any(Number),
    );
    expect(first.retention.run).toHaveBeenCalledTimes(1);
    expect(second.retention.run).not.toHaveBeenCalled();
  });

  it('tick lỗi không ném ra ngoài', async () => {
    const { job, retention } = build();
    retention.run.mockRejectedValueOnce(new Error('db down'));
    await expect(job.handleTick(new Date())).resolves.toBeUndefined();
  });
});
