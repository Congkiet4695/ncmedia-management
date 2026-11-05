import type { FulfillmentIssue, FulfillmentIssueSection } from './types';

/**
 * **Rút gọn lỗi / cảnh báo của màn hình Fulfill** — chỉ là TẦNG HIỂN THỊ, không React, không i18n.
 *
 * 🔴 Backend CỐ Ý trả một issue cho MỖI line item (`FulfillmentReadinessService.resolveItems`) và
 * TikTok trả mỗi đơn vị sản phẩm thành một line item — mua 2 cái cùng biến thể là 2 issue giống hệt
 * nhau. Vì thế khử trùng lặp nằm ở đây, còn `state.issues` / `canFulfill` không bị đụng tới: nút gửi
 * vẫn đọc nguyên văn backend qua `submitBlockers()`.
 *
 * 🔴 KHÔNG khử trùng theo câu chữ. Danh tính của một mục là khoá nghiệp vụ mà backend dùng để tra ánh
 * xạ / design: biến thể `Product ID + TikTok SKU ID` (`fulfillment/shared/mapping-match.ts`). Không có
 * khoá ⇒ mỗi line item là một mục riêng. `message`
 * chỉ được dùng để TÁCH thêm (vd cùng sản phẩm nhưng hai vị trí in khác nhau), không bao giờ để gộp.
 */

export type IssueSeverity = 'error' | 'warning';

/** Phần của dòng hàng dùng để bổ sung ngữ cảnh cho issue không kèm sẵn (DESIGN_*, PLACEMENT_*). */
export interface IssueLineContext {
  id: string;
  productId: string | null;
  productName: string | null;
  skuId: string | null;
  skuName: string | null;
  sellerSku: string | null;
}

export interface FulfillmentIssueEntry {
  key: string;
  /** Câu đầy đủ của backend. */
  message: string;
  productName: string | null;
  productId: string | null;
  sellerSku: string | null;
  skuId: string | null;
  /** Tên biến thể (một khoá ứng với một biến thể; tên có thể đổi giữa các đơn). */
  skuNames: string[];
  /** Số line item bị ảnh hưởng — vd mua 2 cái cùng biến thể ⇒ 2. */
  lineCount: number;
  /**
   * `true` ⇒ mọi thông tin của `message` đã nằm trong các field trên cộng câu hướng dẫn theo mã lỗi,
   * nên không lặp lại câu dài. `false` ⇒ `message` có nội dung riêng và PHẢI được hiển thị.
   */
  structured: boolean;
}

export interface FulfillmentIssueGroup {
  /** Danh tính ổn định để nhớ nhóm nào đang mở: `severity:section:code`. */
  key: string;
  section: FulfillmentIssueSection;
  code: string;
  severity: IssueSeverity;
  entries: FulfillmentIssueEntry[];
}

/**
 * Mã mà `message` của backend CHỈ gồm tên sản phẩm + khoá + câu hướng dẫn cố định, nên dựng lại được
 * đầy đủ từ field. Mã khác (vd DESIGN_NOT_PUBLIC nêu vị trí in) mang dữ liệu riêng trong câu ⇒ giữ nguyên văn.
 */
const STRUCTURED_CODES: ReadonlySet<string> = new Set([
  'MAPPING_MISSING',
  'MAPPING_LEGACY_CONFIRM_REQUIRED',
  'MAPPING_PROVIDER_MISMATCH',
  'DESIGN_LEGACY_CONFIRM_REQUIRED',
  'DESIGN_MISSING',
  'PROMOTION_GIFT_NOT_SENT',
]);

/** Mã có câu hướng dẫn riêng (`fulfill.issue.hint.*`) — chính là các mã đã rút câu dài thành field. */
export function hasIssueHint(code: string): boolean {
  return STRUCTURED_CODES.has(code);
}

const clean = (value: string | null | undefined): string | null => value?.trim() || null;

/** Khoá nghiệp vụ của issue — cùng khoá biến thể với `rowKeyOf` ở backend. */
function identityOf(productId: string | null, skuId: string | null, lineId: string | null): string {
  if (productId && skuId) return `sku-id:${productId}:${skuId}`;
  return lineId ? `line:${lineId}` : 'order';
}

/** Gom issue thành nhóm theo (khối, mã lỗi); trong nhóm, mỗi khoá nghiệp vụ là một mục. */
export function groupFulfillmentIssues(
  issues: readonly FulfillmentIssue[] | null | undefined,
  lines: readonly IssueLineContext[] | null | undefined,
  severity: IssueSeverity,
): FulfillmentIssueGroup[] {
  const lineById = new Map((lines ?? []).map((line) => [line.id, line]));
  const groups = new Map<string, FulfillmentIssueGroup>();
  const entries = new Map<string, FulfillmentIssueEntry>();
  const lineIdsByEntry = new Map<string, Set<string>>();

  for (const issue of issues ?? []) {
    const line = issue.podOrderItemId ? lineById.get(issue.podOrderItemId) : undefined;
    const productId = clean(issue.tiktokProductId) ?? clean(line?.productId);
    const sellerSku = clean(issue.sellerSku) ?? clean(line?.sellerSku);
    const skuId = clean(issue.tiktokSkuId) ?? clean(line?.skuId);
    const productName = clean(issue.productName) ?? clean(line?.productName);
    const skuName = clean(issue.skuName) ?? clean(line?.skuName);

    const groupKey = `${severity}:${issue.section}:${issue.code}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { key: groupKey, section: issue.section, code: issue.code, severity, entries: [] };
      groups.set(groupKey, group);
    }

    const identity = identityOf(productId, skuId, issue.podOrderItemId ?? null);
    const entryKey = JSON.stringify([groupKey, identity, issue.message]);
    let entry = entries.get(entryKey);
    if (!entry) {
      entry = {
        key: entryKey,
        message: issue.message,
        productName,
        productId,
        sellerSku,
        skuId,
        skuNames: [],
        lineCount: 0,
        // Không có sản phẩm để hiển thị thì câu của backend là thông tin duy nhất.
        structured: STRUCTURED_CODES.has(issue.code) && Boolean(productName || productId),
      };
      entries.set(entryKey, entry);
      group.entries.push(entry);
    }
    if (skuName && !entry.skuNames.includes(skuName)) entry.skuNames.push(skuName);
    const lineIds = lineIdsByEntry.get(entryKey) ?? new Set<string>();
    if (issue.podOrderItemId) lineIds.add(issue.podOrderItemId);
    lineIdsByEntry.set(entryKey, lineIds);
    entry.lineCount = lineIds.size;
  }

  return [...groups.values()];
}

/** Tổng số mục (đã khử trùng) — con số hiện ở dòng tóm tắt cạnh nút gửi. */
export function countIssueEntries(groups: readonly FulfillmentIssueGroup[]): number {
  return groups.reduce((total, group) => total + group.entries.length, 0);
}

/**
 * Lý do của MỘT dòng hiển thị (có thể gồm nhiều line item), mỗi lý do một lần — để panel cấu hình
 * không lặp cùng một câu theo số đơn vị.
 */
export function issuesOfLines(
  issues: readonly FulfillmentIssue[],
  lineIds: readonly string[],
): FulfillmentIssue[] {
  const ids = new Set(lineIds);
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (!issue.podOrderItemId || !ids.has(issue.podOrderItemId)) return false;
    const key = JSON.stringify([issue.code, issue.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
