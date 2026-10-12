import { PodFlashSaleRetentionJob } from './pod-flash-sale-retention.job';

describe('PodFlashSaleRetentionJob', () => {
  function build(config: Record<string, unknown>) {
    const registry = { addCronJob: jest.fn() };
    const retention = {
      run: jest.fn().mockResolvedValue({ status: 'COMPLETED' }),
      configuredOptions: jest.fn().mockReturnValue({ dryRun: true }),
    };
    const job = new PodFlashSaleRetentionJob(
      { get: jest.fn((key: string, fallback: unknown) => (key in config ? config[key] : fallback)) } as never,
      registry as never,
      retention as never,
    );
    jest.spyOn(job['logger'], 'log').mockImplementation(() => undefined);
    return { job, registry, retention };
  }

  it('🔴 mặc định TẮT ⇒ không đăng ký cron, không chạy gì khi khởi động / deploy', () => {
    const { job, registry, retention } = build({});

    job.onModuleInit();

    expect(registry.addCronJob).not.toHaveBeenCalled();
    expect(retention.run).not.toHaveBeenCalled();
  });

  it('bật ⇒ đăng ký đúng MỘT cron và KHÔNG chạy ngay lúc khởi động', () => {
    const { job, registry, retention } = build({ 'flashSaleRetention.enabled': true });

    job.onModuleInit();
    const [name, cron] = registry.addCronJob.mock.calls[0] as [string, { stop: () => void }];
    cron.stop();

    expect(name).toBe(PodFlashSaleRetentionJob.JOB_NAME);
    expect(registry.addCronJob).toHaveBeenCalledTimes(1);
    expect(retention.run).not.toHaveBeenCalled();
  });

  it('🔴 TC11 tick đang chạy ⇒ tick chồng bị bỏ qua (cùng tiến trình); khác tiến trình do khoá Redis chặn', async () => {
    const { job, retention } = build({});
    let finish: () => void = () => undefined;
    retention.run.mockReturnValue(new Promise((resolve) => (finish = () => resolve({ status: 'COMPLETED' }))));

    const first = job.handleTick();
    await job.handleTick();
    finish();
    await first;

    expect(retention.run).toHaveBeenCalledTimes(1);
  });
});
