/** Chữ cái đầu (avatar fallback) từ họ tên. */
export function getInitials(name?: string | null): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase() || 'U';
}

/** Định dạng số tiền VND. */
export function formatVnd(value: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(value)} ₫`;
}

/**
 * Định dạng số tiền USD — dùng CHUNG cho Order (Unit Price / Line Total / Order Total).
 * VD: 19.9 → "$19.90", 1250.5 → "$1,250.50". Không format tiền tệ rải rác nơi khác.
 */
export function formatUSD(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

/** Định dạng ISO datetime → dd/MM/yyyy (theo vi-VN). */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    date,
  );
}
