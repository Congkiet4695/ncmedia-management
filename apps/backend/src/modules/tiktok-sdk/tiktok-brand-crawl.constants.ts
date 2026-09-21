/**
 * Hằng số của bộ quét thương hiệu TikTok (`TiktokBrandCrawlerService`).
 *
 * 🔴 Vì sao Get Brands cần một bộ quét riêng thay vì "đi hết page_token" như mọi API khác —
 * ba giới hạn ĐO ĐƯỢC trên API thật (2026-09-18, xem BRAND_SYNC_FIX_REPORT.md):
 *
 *   1. **Cửa sổ 10.000 bản ghi cho MỘT truy vấn.** `page_size × page_number ≤ 10.000`; trang
 *      101 bị từ chối thẳng (`12019123 product of pageSize and pageNumber exceeds the maximum
 *      limit`) và `total_count` cũng bị kẹp ở 10.000. Không lọc thì chỉ lấy được 10.000 thương
 *      hiệu đầu bảng — đúng là "chỉ tới chữ F" mà người dùng thấy.
 *   2. `brand_name` là bộ lọc **bắt đầu bằng** (prefix), không phân biệt hoa/thường, nhận
 *      Unicode. Đây là cách duy nhất để chia không gian tìm kiếm thành các cửa sổ < 10.000.
 *   3. Thứ tự trang **không ổn định giữa các lần gọi**: hai bản sao phía TikTok sắp xếp theo
 *      hai khoá khác nhau, nên một lượt đi hết trang chỉ thu được ~82–85% bản ghi (số còn lại
 *      bị lặp/bỏ sót ở ranh giới trang). Phải đi lại và gộp cho tới khi số bản ghi duy nhất
 *      bằng `total_count`.
 */

/** Trần cứng của TikTok: `page_size × page_number` tối đa cho một truy vấn Get Brands. */
export const TIKTOK_BRAND_WINDOW_LIMIT = 10_000;

/**
 * Số lượt đi hết trang tối đa cho MỘT prefix trước khi chuyển sang chia nhỏ.
 *
 * Mỗi lượt độc lập thu ~85%, phần sót giảm theo luỹ thừa: sau 8 lượt còn ~0,001% mỗi bản ghi.
 * Đi lại RẺ hơn chia nhỏ: một prefix 10.000 bản ghi đi lại tốn 100 call, chia nhỏ tốn ~900
 * (30 prefix con, mỗi con lại đi nhiều lượt). Chỉ khi đi đủ số lượt vẫn thiếu mới chia theo
 * ký tự kế tiếp đã thấy trong tên (prefix dài hơn ⇒ cửa sổ nhỏ hơn ⇒ hội tụ nhanh hơn).
 */
export const TIKTOK_BRAND_CRAWL_MAX_WALKS = 8;

/**
 * Số prefix được quét song song. Trần tần suất do TikTok cấp động; 4 luồng ≈ 7–8 call/giây,
 * đo thực tế không chạm 429. Đặt cao hơn chỉ đổi thời gian chờ lấy lỗi rate limit.
 */
export const TIKTOK_BRAND_CRAWL_CONCURRENCY = 4;

/** Prefix dài hơn mức này mà vẫn ≥ 10.000 kết quả là dữ liệu bất thường — dừng chia, báo thiếu. */
export const TIKTOK_BRAND_CRAWL_MAX_PREFIX_LENGTH = 48;

/**
 * Số prefix hỏng LIÊN TIẾP (sau khi SDK đã retry) trước khi huỷ cả lượt.
 *
 * Một prefix hỏng lẻ tẻ thì ghi nhận rồi đi tiếp — dữ liệu các prefix khác vẫn được ghi. Nhưng
 * hỏng liên tiếp là token hết hạn hoặc TikTok sập: quét tiếp chỉ đốt hàng nghìn call vô ích.
 */
export const TIKTOK_BRAND_CRAWL_MAX_CONSECUTIVE_FAILURES = 10;

/** Cứ sau chừng này lời gọi thì báo tiến độ một lần (log + trạng thái cho giao diện). */
export const TIKTOK_BRAND_CRAWL_PROGRESS_EVERY_CALLS = 100;

/**
 * Bảng chữ cái ASCII in được (không phân biệt hoa/thường) — ký tự kế tiếp dùng để chia một
 * prefix đã chạm trần. Gồm cả dấu cách và dấu câu vì tên thương hiệu có đủ loại
 * ("A + D", "G & J's Finest", "[less is more]").
 */
export const TIKTOK_BRAND_PREFIX_BASE_ALPHABET: readonly string[] = buildAsciiAlphabet();

/**
 * Chữ Latin có dấu (é, ñ, ü, ß, ā, ł, ạ, ế, ờ…) — mồi cho MỌI prefix chạm trần, không chỉ gốc.
 *
 * 🔴 Bài học từ lượt chạy thật đầu tiên (2026-09-18): cửa sổ 10.000 của prefix "c" sắp theo
 * ASCII nên chỉ lộ ra "ca…", "cb…"; "cá" (275 thương hiệu: "Cá Mập Gold X2"…) và "cơ" (128)
 * không bao giờ xuất hiện trong đó và bị bỏ sót. Tên Việt / Âu có dấu ở ký tự thứ hai là
 * chuyện thường, nên bộ mồi này phải được gieo ở từng tầng chạm trần (~140 truy vấn mỗi tầng).
 */
export const TIKTOK_BRAND_PREFIX_LATIN_SEEDS: readonly string[] = buildSeeds([
  [0x00c0, 0x00ff], // Latin-1 Supplement (é, ñ, ü, ß…)
  [0x0100, 0x017f], // Latin Extended-A (ā, ł, ş, đ…)
  [0x01a0, 0x01b0], // Latin Extended-B — đoạn chứa ơ / ư của tiếng Việt
  [0x1ea0, 0x1ef9], // Latin Extended Additional (tiếng Việt: ạ, ế, ờ…)
]);

/**
 * Dấu tổ hợp (combining marks) — mồi cho MỌI prefix chạm trần.
 *
 * 🔴 Đo được ở lượt chạy thật thứ hai: TikTok lưu tên ở CẢ hai dạng Unicode và so khớp theo
 * code point — `"ba" + U+0301` (dạng tổ hợp) trả 171 thương hiệu ("Bánh Kẹo Bảo Minh"…) trong
 * khi `"bá"` (dạng dựng sẵn) trả 605 thương hiệu khác. Dấu tổ hợp đứng sau chữ cái nên không
 * bao giờ lộ ra trong cửa sổ ASCII của prefix cha; không gieo là mất trọn nhóm này.
 */
export const TIKTOK_BRAND_PREFIX_MARK_SEEDS: readonly string[] = buildMarkSeeds(0x0300, 0x0323);

/**
 * Ký tự MỞ ĐẦU của các hệ chữ ngoài Latin — chỉ dùng ở gốc (prefix rỗng), cộng thêm
 * `TIKTOK_BRAND_PREFIX_LATIN_SEEDS`.
 *
 * 🔴 Vì sao cần: cửa sổ 10.000 không lọc được sắp theo tên nên chỉ chứa dấu câu, chữ số và
 * A–F; tên bắt đầu bằng chữ Thái ("เคลียร์" — 2.750 thương hiệu), Kirin, Ả Rập, kana… không
 * bao giờ lộ ra từ đó. Không có mồi thì không có đường nào tới chúng.
 *
 * Hán tự (CJK) và Hangul KHÔNG liệt kê được (hàng chục nghìn ký tự) — chúng được phát hiện
 * động từ ký tự xuất hiện trong tên đã lấy về (xem `TiktokBrandCrawlerService`).
 */
export const TIKTOK_BRAND_PREFIX_SCRIPT_SEEDS: readonly string[] = buildSeeds([
  [0x03b1, 0x03c9], // Hy Lạp
  [0x0430, 0x045f], // Kirin
  [0x05d0, 0x05ea], // Do Thái
  [0x0621, 0x064a], // Ả Rập
  [0x0e01, 0x0e2e], // Thái — phụ âm
  [0x0e40, 0x0e44], // Thái — nguyên âm đứng trước
  [0x3041, 0x3096], // Hiragana
  [0x30a1, 0x30fa], // Katakana
  [0xff10, 0xff19], // Chữ số toàn chiều rộng
  [0xff41, 0xff5a], // Chữ Latin toàn chiều rộng
]);

function buildAsciiAlphabet(): string[] {
  const chars: string[] = [];
  // 0x20 (dấu cách) → 0x7E ('~'), bỏ chữ HOA vì bộ lọc không phân biệt hoa/thường.
  for (let code = 0x20; code <= 0x7e; code++) {
    const char = String.fromCharCode(code);
    if (char >= 'A' && char <= 'Z') continue;
    chars.push(char);
  }
  return chars;
}

/** Dấu tổ hợp trong dải đã cho (U+0300 – U+0323 phủ toàn bộ dấu tiếng Việt và châu Âu). */
function buildMarkSeeds(from: number, to: number): string[] {
  const marks: string[] = [];
  for (let code = from; code <= to; code++) {
    const char = String.fromCodePoint(code);
    if (/\p{M}/u.test(char)) marks.push(char);
  }
  return marks;
}

/** Chữ/số trong các dải code point đã cho, đã chuẩn hoá và khử trùng. */
function buildSeeds(ranges: Array<[number, number]>): string[] {
  const seen = new Set<string>();
  for (const [from, to] of ranges) {
    for (let code = from; code <= to; code++) {
      const char = String.fromCodePoint(code);
      if (!/[\p{L}\p{N}]/u.test(char)) continue;
      const folded = foldBrandPrefixChar(char);
      // Ký tự gập về ASCII ('İ' → 'i') đã nằm trong bảng ASCII — không gieo lại.
      if (folded.charCodeAt(0) <= 0x7e) continue;
      seen.add(folded);
    }
  }
  return [...seen];
}

/**
 * Chuẩn hoá MỘT ký tự để so khớp/khử trùng prefix. Bộ lọc của TikTok không phân biệt
 * hoa/thường nên hai prefix chỉ khác hoa/thường là cùng một truy vấn.
 *
 * Ký tự mà hạ chữ thường nở thành nhiều code point ('İ' → "i̇") được rút về chữ cơ sở ('i'):
 * đo thực tế TikTok coi "İn" ≡ "in" (cùng total_count), giữ 'İ' riêng là quét trùng cả cây "i".
 */
export function foldBrandPrefixChar(char: string): string {
  const lower = char.toLowerCase();
  const points = Array.from(lower);
  if (points.length === 1) return lower;
  const base = points.find((point) => !/\p{M}/u.test(point));
  return base ?? char;
}
