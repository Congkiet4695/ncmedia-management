/**
 * Chuyển đổi giữa **giờ treo tường** (thứ người dùng gõ vào ô `datetime-local`) và **mốc
 * UTC** (thứ backend lưu và gửi lên TikTok).
 *
 * 🔴 Vì sao không dùng thẳng `new Date(localString)`: trình duyệt sẽ diễn giải chuỗi đó theo
 * múi giờ CỦA MÁY người dùng. Một người ở Việt Nam đặt đợt sale "20:00 giờ New York" mà gõ
 * `20:00` thì đợt sale sẽ chạy sai 11–12 tiếng. Ô nhập luôn là giờ của múi giờ ĐÃ CHỌN, và
 * hai hàm dưới đây là chỗ duy nhất biết cách quy đổi.
 *
 * Không kéo thêm thư viện (date-fns-tz, luxon…): `Intl.DateTimeFormat` với `timeZone` đã đủ
 * để tính độ lệch, và đây là toàn bộ nhu cầu của module.
 */

/** Múi giờ của trình duyệt — giá trị mặc định khi tạo đợt sale mới. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Danh sách múi giờ cho dropdown.
 *
 * 🔴 Lấy từ `Intl.supportedValuesOf` thay vì gõ tay một danh sách: danh sách gõ tay sẽ cũ đi
 * và luôn thiếu đúng múi giờ mà một khách hàng nào đó cần. Trình duyệt cũ không có API này
 * ⇒ lùi về một danh sách nhỏ gồm các thị trường TikTok Shop đang phục vụ.
 */
export function listTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    const values = intl.supportedValuesOf?.('timeZone');
    if (values && values.length > 0) return values;
  } catch {
    // Rơi xuống danh sách dự phòng bên dưới.
  }
  return [
    'UTC',
    'Asia/Ho_Chi_Minh',
    'Asia/Bangkok',
    'Asia/Singapore',
    'Asia/Kuala_Lumpur',
    'Asia/Jakarta',
    'Asia/Manila',
    'Asia/Tokyo',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Paris',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'America/Mexico_City',
  ];
}

/** Độ lệch (ms) của một múi giờ tại một thời điểm cụ thể — đã tính cả giờ mùa hè. */
function offsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // `hour12: false` cho ra "24" thay vì "00" ở nửa đêm trên một số môi trường.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/**
 * `"2026-09-01T20:00"` trong múi giờ đã chọn ⇒ ISO-8601 ở UTC.
 *
 * Tính độ lệch HAI lần: lần đầu dùng độ lệch tại mốc UTC ước lượng, lần hai dùng độ lệch tại
 * mốc vừa tính. Cần thiết ở ranh giới đổi giờ mùa hè, nơi độ lệch trước và sau khác nhau —
 * một lần lặp sẽ lệch đúng một giờ ở những ngày đó.
 */
export function localToUtcIso(local: string, timeZone: string): string | null {
  if (!local) return null;
  // Ô `datetime-local` cho ra `YYYY-MM-DDTHH:mm`; thêm giây và `Z` để diễn giải như UTC trước.
  const naive = new Date(`${local.length === 16 ? `${local}:00` : local}Z`);
  if (Number.isNaN(naive.getTime())) return null;

  let utc = new Date(naive.getTime() - offsetMs(naive, timeZone));
  utc = new Date(naive.getTime() - offsetMs(utc, timeZone));
  return utc.toISOString();
}

/** ISO-8601 (UTC) ⇒ `"YYYY-MM-DDTHH:mm"` để đổ vào ô `datetime-local`. */
export function utcIsoToLocal(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const shifted = new Date(date.getTime() + offsetMs(date, timeZone));
  // `toISOString` luôn cho UTC; đã cộng độ lệch nên phần trước `Z` chính là giờ treo tường.
  return shifted.toISOString().slice(0, 16);
}
