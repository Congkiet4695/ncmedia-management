'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/modal';
import { FulfillmentIssueGroups } from '@/features/fulfillment/components/fulfillment-issue-groups';
import {
  countIssueEntries,
  groupFulfillmentIssues,
  type IssueLineContext,
} from '@/features/fulfillment/issue-summary';
import type { FulfillmentIssue } from '@/features/fulfillment/types';

/** Cảnh báo quà tặng đã có ở nút quà trong cột Products, không tính lại ở đây. */
const GIFT_NOTICE_CODE = 'PROMOTION_GIFT_NOT_SENT';

interface FulfillmentIssueButtonProps {
  /** Lỗi chặn gửi. */
  issues: FulfillmentIssue[];
  /** Cảnh báo không chặn gửi. */
  warnings: FulfillmentIssue[];
  lines: readonly IssueLineContext[];
}

/**
 * Lỗi / cảnh báo của cột Fulfillment: mỗi loại một nút có số lượng, nội dung đầy đủ nằm trong hộp thoại, dùng chung cách
 * gom của drawer Fulfill. Lỗi và cảnh báo giữ hai biểu tượng và màu riêng. Dòng bảng bật/mở khi click nên mọi click trong
 * đây đều dừng lan truyền.
 */
export function FulfillmentIssueButton({ issues, warnings, lines }: FulfillmentIssueButtonProps) {
  const { t } = useTranslation(['pod']);
  const [open, setOpen] = useState(false);

  const errorGroups = useMemo(() => groupFulfillmentIssues(issues, lines, 'error'), [issues, lines]);
  const warningGroups = useMemo(
    () =>
      groupFulfillmentIssues(
        warnings.filter((warning) => warning.code !== GIFT_NOTICE_CODE),
        lines,
        'warning',
      ),
    [warnings, lines],
  );
  const groups = useMemo(() => [...errorGroups, ...warningGroups], [errorGroups, warningGroups]);
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string> | null>(null);
  const errorCount = countIssueEntries(errorGroups);
  const warningCount = countIssueEntries(warningGroups);

  if (groups.length === 0) return null;

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded text-[11px] font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {errorCount > 0 && (
          <span className="inline-flex items-center gap-1 text-destructive">
            <AlertCircle className="size-3 shrink-0" />
            {t('pod:orders.fulfillment.issueCount', { count: errorCount })}
          </span>
        )}
        {warningCount > 0 && (
          <span className="inline-flex items-center gap-1 text-warning">
            <AlertTriangle className="size-3 shrink-0" />
            {t('pod:orders.fulfillment.warningCount', { count: warningCount })}
          </span>
        )}
      </button>

      {open && (
        <Modal open onClose={() => setOpen(false)} title={t('pod:orders.fulfillment.issuesTitle')}>
          <FulfillmentIssueGroups
            groups={groups}
            // Vừa mở là để đọc: mọi nhóm đều mở sẵn; `null` = người dùng chưa đóng nhóm nào.
            openKeys={openKeys ?? new Set(groups.map((group) => group.key))}
            onToggle={(key) =>
              setOpenKeys((prev) => {
                const next = new Set(prev ?? groups.map((group) => group.key));
                if (!next.delete(key)) next.add(key);
                return next;
              })
            }
          />
        </Modal>
      )}
    </div>
  );
}
