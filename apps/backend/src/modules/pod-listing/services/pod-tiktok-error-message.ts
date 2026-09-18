import { TIKTOK_ERROR_CODES } from '../../pod-tiktok/constants/tiktok-error-code.constants';

/**
 * Dịch lỗi TikTok trả về khi đăng sản phẩm sang thông điệp người vận hành đọc được.
 *
 * 🔴 `36009004` là mã DÙNG CHUNG cho mọi lỗi request-validation của TikTok (xem
 * `tiktok-error-code.constants.ts`), nên phải khớp theo TỪ KHOÁ trong `message`, không phải
 * theo số. Chỉ những lỗi đã biết rõ nguyên nhân + cách sửa mới được dịch; lỗi lạ giữ nguyên
 * câu của TikTok — dịch mò một lỗi lạ là chỉ sai đường cho người sửa.
 *
 * Câu gốc của TikTok LUÔN còn trong log của item (`tiktokCode` + `message`), thứ này chỉ thay
 * cột `error` hiển thị trên màn hình.
 */
const KNOWN_ERRORS: ReadonlyArray<{
  codes: ReadonlySet<number>;
  pattern: RegExp;
  message: string;
}> = [
  {
    // "Parameter 'description <img>' src is invalid … use_case=DESCRIPTION_IMAGE" /
    // "product description image uri illegal".
    codes: new Set([12052340]),
    pattern: /description.*(img|image)|image uri illegal/i,
    message:
      'Ảnh trong mô tả sản phẩm chưa được upload đúng chuẩn TikTok Shop. Hệ thống sẽ upload lại ảnh với mục đích DESCRIPTION_IMAGE.',
  },
  {
    codes: new Set([TIKTOK_ERROR_CODES.INVALID_REQUEST]),
    pattern: /currency.*(required|not been provided|missing)/i,
    message:
      'Currency của giá sản phẩm đang bị thiếu. Vui lòng kiểm tra Market/Shop của lượt đăng và thử lại.',
  },
];

/** Thông điệp thân thiện cho lỗi TikTok đã biết, hoặc `null` nếu không nhận ra. */
export function humanizeTiktokListingError(
  tiktokCode: number | null | undefined,
  rawMessage: string,
): string | null {
  for (const known of KNOWN_ERRORS) {
    if (tiktokCode !== null && tiktokCode !== undefined && !known.codes.has(tiktokCode)) continue;
    if (known.pattern.test(rawMessage)) return `${known.message} (TikTok ${tiktokCode ?? '?'})`;
  }
  return null;
}
