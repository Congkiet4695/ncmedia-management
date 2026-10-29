/** PostgreSQL 55P03 `lock_not_available` — hết `lock_timeout` khi chờ khoá hàng. */
export function isLockNotAvailable(error: unknown): boolean {
  const record = error as { code?: string; meta?: { code?: string }; message?: string } | null;
  return (
    record?.code === '55P03' ||
    record?.meta?.code === '55P03' ||
    /lock timeout|could not obtain lock|55P03/i.test(record?.message ?? '')
  );
}
