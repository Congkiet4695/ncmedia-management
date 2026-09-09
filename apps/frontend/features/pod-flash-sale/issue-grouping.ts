import type { PodFlashSaleIssue } from './types';

/**
 * Gom nhóm lỗi/cảnh báo của Flash Sale để HIỂN THỊ — **hàm thuần, không React**.
 *
 * 🔴 Vấn đề đang giải: một đợt sale 600 SKU chưa đặt giá sinh ra 600 lỗi giống hệt nhau, và
 * màn hình in ra "602 issues to fix before publishing" kèm 602 dòng chữ y như nhau. Danh
 * sách đó không nói cho người vận hành biết điều gì mà một dòng không nói được, còn cuộn qua
 * nó thì che mất hai lỗi THẬT SỰ khác nằm lẫn bên trong.
 *
 * 🔴 Gom ở TẦNG HIỂN THỊ, không phải ở validator. `validation.issues` giữ nguyên đủ 602 mục
 * — mỗi mục vẫn mang `itemId` của nó, và bảng sản phẩm vẫn tô đỏ đúng từng dòng hỏng. Cắt
 * bớt ở nguồn là làm mất dữ liệu; gom ở đây chỉ đổi cách trình bày.
 *
 * 🔴 Khoá gom là `code`, KHÔNG phải nội dung câu chữ. Nhiều thông điệp nhúng số của riêng
 * từng dòng ("Giá deal 25.00 cao hơn giá niêm yết 20.00"), nên gom theo chuỗi sẽ ra 600 nhóm
 * một-phần-tử — đúng thứ đang cần tránh. `code` là danh tính máy đọc được và ổn định qua mọi
 * ngôn ngữ. Chỉ khi thiếu `code` mới lùi về so khớp chuỗi đã chuẩn hoá.
 */

/** Một nhóm lỗi đã gom — thứ giao diện thực sự vẽ ra. */
export interface GroupedIssue {
  /** Mã lỗi (hoặc thông điệp đã chuẩn hoá khi bản ghi không có mã). */
  key: string;
  code: string | null;
  level: 'ERROR' | 'WARNING';
  /** Thông điệp đại diện — bản đầu tiên gặp trong nhóm. */
  message: string;
  /** Tổng số lỗi gốc thuộc nhóm này. */
  count: number;
  /** Số DÒNG sản phẩm bị ảnh hưởng (lỗi phần đầu không gắn dòng nào ⇒ 0). */
  affectedItems: number;
  /**
   * Vài thông điệp KHÁC NHAU trong cùng nhóm, để người dùng mở ra xem chi tiết.
   *
   * Có trần: một nhóm 600 dòng thì 600 câu chữ khác nhau cũng không ai đọc hết, và giữ hết
   * chúng trong bộ nhớ chỉ để không hiển thị là lãng phí.
   */
  samples: string[];
}

/** Số mẫu tối đa giữ lại cho mỗi nhóm. */
export const ISSUE_SAMPLE_LIMIT = 3;

/**
 * Chuẩn hoá thông điệp khi bản ghi KHÔNG có `code`.
 *
 * Bỏ khoảng trắng thừa, hạ chữ thường, và thay mọi cụm số bằng một dấu hiệu chung — nhờ vậy
 * "Giá deal 25.00 cao hơn giá niêm yết 20.00" và "…12.50 … 10.00" rơi vào cùng một nhóm.
 */
export function normalizeIssueMessage(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .replace(/\d+([.,]\d+)?/g, '#')
    .replace(/\s+/g, ' ');
}

/**
 * Gom danh sách lỗi thành các nhóm, GIỮ NGUYÊN thứ tự xuất hiện đầu tiên.
 *
 * Giữ thứ tự có chủ đích: lỗi phần đầu (tên, khung giờ) do validator sinh ra trước lỗi từng
 * dòng, nên chúng vẫn nằm trên cùng thay vì bị một nhóm 600 dòng đẩy xuống dưới.
 */
export function groupIssues(issues: readonly PodFlashSaleIssue[]): GroupedIssue[] {
  const groups = new Map<string, GroupedIssue>();

  for (const issue of issues) {
    const key = issue.code ?? `msg:${normalizeIssueMessage(issue.message)}`;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key,
        code: issue.code ?? null,
        level: issue.level,
        message: issue.message,
        count: 1,
        affectedItems: issue.itemId ? 1 : 0,
        samples: [issue.message],
      });
      continue;
    }

    existing.count += 1;
    if (issue.itemId) existing.affectedItems += 1;
    // Chỉ giữ những câu chữ THỰC SỰ khác nhau — lặp lại cùng một câu không phải là "mẫu".
    if (existing.samples.length < ISSUE_SAMPLE_LIMIT && !existing.samples.includes(issue.message)) {
      existing.samples.push(issue.message);
    }
  }

  return [...groups.values()];
}

/**
 * Số hiển thị ở tiêu đề: "**3** vấn đề cần xử lý", không phải "602".
 *
 * 🔴 Đếm NHÓM chứ không đếm bản ghi. "602 vấn đề" khiến người vận hành nghĩ có 602 việc phải
 * làm, trong khi thực tế chỉ có 3 thao tác sửa — và một trong số đó là "đặt lại % giảm" áp
 * cho cả loạt bằng Batch Update.
 */
export function countIssueGroups(issues: readonly PodFlashSaleIssue[]): number {
  return groupIssues(issues).length;
}
