import {
  NotificationEventStatus,
  PodListingJobStatus,
  PodListingPayloadStatus,
  Prisma,
} from '@prisma/client';
import { POD_LISTING_JOB_ITEM_ACTIVE_STATUSES } from '../../pod-listing/constants/pod-listing.constants';
import type { DataRetentionTask } from '../constants/data-retention.constants';

/**
 * Một BƯỚC xoá của tác vụ — một bảng, xoá theo lô.
 *
 * `eligible` là mệnh đề `FROM <bảng> x WHERE …` (alias `x`) dùng chung cho ĐẾM và XOÁ — một nguồn điều
 * kiện duy nhất. `recheck` là điều kiện kiểm LẠI trên chính dòng bị xoá (alias `t`): PostgreSQL đánh giá
 * lại nó trên phiên bản mới nhất của dòng nếu dòng vừa bị tiến trình khác cập nhật trong lúc chờ khoá.
 */
export interface RetentionStage {
  name: string;
  table: string;
  eligible: Prisma.Sql;
  recheck: Prisma.Sql;
}

/** Nhóm dữ liệu CŨ HƠN mốc nhưng CỐ Ý không xoá — báo số lượng để vận hành biết vì sao còn lại. */
export interface RetentionKeptRule {
  reason: string;
  count: Prisma.Sql;
}

export interface RetentionTaskPlan {
  task: DataRetentionTask;
  stages: RetentionStage[];
  kept: RetentionKeptRule[];
}

// ---------------------------------------------------------------------------
// Tập trạng thái — ép kiểu enum Postgres để vẫn dùng được index trên cột status
// ---------------------------------------------------------------------------

function enumList(values: readonly string[], pgType: string): Prisma.Sql {
  return Prisma.join(values.map((value) => Prisma.sql`${value}::${Prisma.raw(`"${pgType}"`)}`));
}

/** Đã gửi xong / thất bại hẳn / bỏ qua — worker không bao giờ đụng lại. PENDING / PROCESSING thì giữ. */
const NOTIFICATION_FINISHED = [
  NotificationEventStatus.SENT,
  NotificationEventStatus.FAILED,
  NotificationEventStatus.SKIPPED,
];
const NOTIFICATION_UNFINISHED = [
  NotificationEventStatus.PENDING,
  NotificationEventStatus.PROCESSING,
];

/** Lượt chạy đã KẾT THÚC. PENDING / PROCESSING không bao giờ bị xoá. */
const JOB_FINISHED = [
  PodListingJobStatus.COMPLETED,
  PodListingJobStatus.COMPLETED_WITH_ERRORS,
  PodListingJobStatus.FAILED,
  PodListingJobStatus.CANCELLED,
];

/**
 * Trạng thái được coi là "draft" có thể dọn. KHÔNG có: `PUBLISHING` (đang gửi), `TIKTOK_DRAFT` (đã có
 * Draft Product trên sàn), `PUBLISHED` (đã lên sàn — là chốt chống publish trùng + dữ liệu lịch sử).
 */
const DRAFT_DISPOSABLE = [
  PodListingPayloadStatus.DRAFT,
  PodListingPayloadStatus.READY,
  PodListingPayloadStatus.FAILED,
  PodListingPayloadStatus.ARCHIVED,
];

const sqlJobFinished = enumList(JOB_FINISHED, 'pod_listing_job_status');
const sqlItemActive = enumList(POD_LISTING_JOB_ITEM_ACTIVE_STATUSES, 'pod_listing_job_item_status');

// ---------------------------------------------------------------------------
// RECENT_NOTIFICATIONS
// ---------------------------------------------------------------------------

function recentNotifications(cutoff: Date): RetentionTaskPlan {
  const finished = enumList(NOTIFICATION_FINISHED, 'notification_event_status');
  return {
    task: 'RECENT_NOTIFICATIONS',
    stages: [
      {
        name: 'notification_events',
        table: 'notification_events',
        eligible: Prisma.sql`FROM notification_events x WHERE x.created_at < ${cutoff} AND x.status IN (${finished})`,
        recheck: Prisma.sql`t.created_at < ${cutoff} AND t.status IN (${finished})`,
      },
    ],
    kept: [
      {
        // Outbox còn đang gửi / chờ retry: xoá là MẤT thông báo chưa tới tay người nhận.
        reason: 'UNFINISHED_DELIVERY',
        count: Prisma.sql`SELECT COUNT(*) AS n FROM notification_events x
          WHERE x.created_at < ${cutoff}
            AND x.status IN (${enumList(NOTIFICATION_UNFINISHED, 'notification_event_status')})`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// PUBLISH_HISTORY
// ---------------------------------------------------------------------------

/**
 * Id các lượt chạy hết hạn: đã kết thúc, mốc kết thúc (thiếu thì mốc tạo) trước `cutoff`, và không còn
 * item nào đang chạy / chờ chạy lại.
 *
 * 🔴 Mốc tuổi là `COALESCE(finished_at, created_at)` — thời điểm lượt publish KẾT THÚC, không phải
 * `updated_at` (cột đó đổi cả khi người dùng chỉ đổi tên / xoá mềm).
 */
function expiredJobIds(cutoff: Date): Prisma.Sql {
  return Prisma.sql`SELECT j.id FROM pod_listing_jobs j
    WHERE j.status IN (${sqlJobFinished})
      AND COALESCE(j.finished_at, j.created_at) < ${cutoff}
      AND NOT EXISTS (
        SELECT 1 FROM pod_listing_job_items a WHERE a.job_id = j.id AND a.status IN (${sqlItemActive}))`;
}

function publishHistory(cutoff: Date): RetentionTaskPlan {
  // `= ANY(ARRAY(...))`: tập id job được tính MỘT lần mỗi lệnh rồi đi theo index `job_id` của bảng con —
  // không JOIN quét cả bảng log ở mỗi lô.
  const jobs = expiredJobIds(cutoff);
  return {
    task: 'PUBLISH_HISTORY',
    stages: [
      {
        name: 'listing_logs',
        table: 'pod_listing_logs',
        eligible: Prisma.sql`FROM pod_listing_logs x WHERE x.job_id = ANY(ARRAY(${jobs}))`,
        recheck: Prisma.sql`TRUE`,
      },
      {
        name: 'listing_job_items',
        table: 'pod_listing_job_items',
        eligible: Prisma.sql`FROM pod_listing_job_items x WHERE x.job_id = ANY(ARRAY(${jobs}))`,
        recheck: Prisma.sql`t.status NOT IN (${sqlItemActive})`,
      },
      {
        name: 'listing_jobs',
        table: 'pod_listing_jobs',
        eligible: Prisma.sql`FROM pod_listing_jobs x WHERE x.id = ANY(ARRAY(${jobs}))`,
        recheck: Prisma.sql`t.status IN (${sqlJobFinished}) AND COALESCE(t.finished_at, t.created_at) < ${cutoff}`,
      },
    ],
    kept: [
      {
        // Lượt cũ nhưng vẫn còn đang chạy / còn item chờ retry — để lượt sau.
        reason: 'JOB_STILL_RUNNING',
        count: Prisma.sql`SELECT COUNT(*) AS n FROM pod_listing_jobs x
          WHERE x.created_at < ${cutoff} AND x.id <> ALL(ARRAY(${jobs}))`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// DRAFT_LISTINGS
// ---------------------------------------------------------------------------

/**
 * Draft hết hạn (alias tuỳ chỗ dùng): trạng thái draft, chưa từng lên sàn, KHÔNG có id phía TikTok,
 * không bị item nào đang chạy giữ, và lần (tái) sinh nội dung gần nhất (`updated_at`) trước `cutoff`.
 *
 * 🔴 Vì sao bỏ qua draft có `tiktok_draft_id` / `tiktok_product_id`: bản ghi đó là thứ duy nhất nhớ
 * rằng trên TikTok đã có sản phẩm cho (nguồn × shop) này — xoá đi thì lượt đăng / generate sau sẽ TẠO
 * TRÙNG sản phẩm trên sàn. Chúng được đếm vào `kept.ON_TIKTOK` để vận hành xử lý tay.
 *
 * 🔴 Mốc tuổi là `updated_at`: draft được sinh lại (upsert) theo cùng khoá nguồn × shop, nên `created_at`
 * là lần sinh ĐẦU, còn `updated_at` mới là lần nội dung còn được dùng gần nhất.
 */
function disposableDraft(alias: string, cutoff: Date): Prisma.Sql {
  const a = Prisma.raw(alias);
  return Prisma.sql`${a}.updated_at < ${cutoff}
    AND ${a}.went_live_at IS NULL
    AND ${a}.status IN (${enumList(DRAFT_DISPOSABLE, 'pod_listing_payload_status')})
    AND ${a}.tiktok_draft_id IS NULL
    AND ${a}.tiktok_product_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM pod_listing_job_items a WHERE a.payload_id = ${a}.id AND a.status IN (${sqlItemActive}))`;
}

function draftListings(cutoff: Date): RetentionTaskPlan {
  return {
    task: 'DRAFT_LISTINGS',
    stages: [
      {
        name: 'listing_payload_items',
        table: 'pod_listing_payload_items',
        eligible: Prisma.sql`FROM pod_listing_payload_items x
          WHERE x.payload_id IN (SELECT p.id FROM pod_listing_payloads p WHERE ${disposableDraft('p', cutoff)})`,
        recheck: Prisma.sql`TRUE`,
      },
      {
        name: 'listing_payloads',
        table: 'pod_listing_payloads',
        eligible: Prisma.sql`FROM pod_listing_payloads x WHERE ${disposableDraft('x', cutoff)}`,
        recheck: disposableDraft('t', cutoff),
      },
    ],
    kept: [
      {
        reason: 'ON_TIKTOK',
        count: Prisma.sql`SELECT COUNT(*) AS n FROM pod_listing_payloads x
          WHERE x.updated_at < ${cutoff}
            AND x.went_live_at IS NULL
            AND x.status <> ${PodListingPayloadStatus.PUBLISHED}::"pod_listing_payload_status"
            AND (x.tiktok_draft_id IS NOT NULL OR x.tiktok_product_id IS NOT NULL)`,
      },
      {
        reason: 'IN_PROGRESS',
        count: Prisma.sql`SELECT COUNT(*) AS n FROM pod_listing_payloads x
          WHERE x.updated_at < ${cutoff}
            AND x.went_live_at IS NULL
            AND x.tiktok_draft_id IS NULL AND x.tiktok_product_id IS NULL
            AND (x.status = ${PodListingPayloadStatus.PUBLISHING}::"pod_listing_payload_status"
              OR EXISTS (SELECT 1 FROM pod_listing_job_items a
                          WHERE a.payload_id = x.id AND a.status IN (${sqlItemActive})))`,
      },
    ],
  };
}

const BUILDERS: Record<DataRetentionTask, (cutoff: Date) => RetentionTaskPlan> = {
  RECENT_NOTIFICATIONS: recentNotifications,
  PUBLISH_HISTORY: publishHistory,
  DRAFT_LISTINGS: draftListings,
};

export function buildRetentionTaskPlan(task: DataRetentionTask, cutoff: Date): RetentionTaskPlan {
  return BUILDERS[task](cutoff);
}

/** Đếm số dòng đủ điều kiện của một bước. */
export function countStageQuery(stage: RetentionStage): Prisma.Sql {
  return Prisma.sql`SELECT COUNT(*) AS n ${stage.eligible}`;
}

/**
 * MỘT lô: xoá tối đa `limit` dòng đủ điều kiện.
 *
 * `FOR UPDATE OF x SKIP LOCKED`: dòng đang bị tiến trình khác giữ (worker gửi thông báo, job đang ghi,
 * lệnh tạo job đang tham chiếu payload) bị BỎ QUA ở lô này thay vì chờ — lượt sau xét lại. Không có con
 * trỏ: điều kiện là trạng thái dữ liệu, nên bị ngắt giữa chừng thì lượt sau tự làm tiếp phần còn lại.
 */
export function deleteBatchQuery(stage: RetentionStage, limit: number): Prisma.Sql {
  return Prisma.sql`DELETE FROM ${Prisma.raw(stage.table)} t
    WHERE t.id IN (SELECT x.id ${stage.eligible} LIMIT ${limit} FOR UPDATE OF x SKIP LOCKED)
      AND ${stage.recheck}`;
}
