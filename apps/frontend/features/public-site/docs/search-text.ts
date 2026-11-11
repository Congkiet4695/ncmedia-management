/**
 * Chuẩn hoá văn bản để tìm kiếm tiếng Việt có dấu / không dấu như nhau.
 * Tách riêng (không kèm nội dung bài) để component client import mà không kéo toàn bộ JSON tài liệu vào bundle.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export interface DocSearchEntry {
  slug: string;
  title: string;
  group: string;
  summary: string;
  /** Văn bản đã chuẩn hoá (bỏ dấu, chữ thường) gồm tiêu đề, nhóm, tóm tắt, tên các bước. */
  haystack: string;
}
