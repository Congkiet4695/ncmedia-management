import type { Prisma } from '@prisma/client';
import { buildRetentionTaskPlan, countStageQuery, deleteBatchQuery } from './data-retention.tasks';

/**
 * Điều kiện xoá của từng tác vụ — kiểm trên đúng SQL + tham số gửi xuống Postgres.
 * (Hành vi thật trên database: test/manual/e2e-hard-delete-retention.manual.ts.)
 */
const CUTOFF = new Date('2026-10-23T07:00:00.000Z');

function flat(sql: Prisma.Sql): string {
  return sql.sql.replace(/\s+/g, ' ');
}

describe('data-retention tasks', () => {
  it('RECENT_NOTIFICATIONS: chỉ xoá sự kiện ĐÃ XONG (SENT/FAILED/SKIPPED) tạo trước mốc', () => {
    const plan = buildRetentionTaskPlan('RECENT_NOTIFICATIONS', CUTOFF);
    expect(plan.stages.map((stage) => stage.table)).toEqual(['notification_events']);
    const sql = countStageQuery(plan.stages[0]);
    expect(flat(sql)).toContain('x.created_at <');
    expect(sql.values).toEqual([CUTOFF, 'SENT', 'FAILED', 'SKIPPED']);
    // PENDING / PROCESSING (còn đang gửi) được giữ và báo số lượng.
    expect(plan.kept.map((rule) => rule.reason)).toEqual(['UNFINISHED_DELIVERY']);
    expect(plan.kept[0].count.values).toEqual([CUTOFF, 'PENDING', 'PROCESSING']);
  });

  it('PUBLISH_HISTORY: log → item → job, chỉ job ĐÃ KẾT THÚC trước mốc và không còn item đang chạy', () => {
    const plan = buildRetentionTaskPlan('PUBLISH_HISTORY', CUTOFF);
    expect(plan.stages.map((stage) => stage.table)).toEqual([
      'pod_listing_logs',
      'pod_listing_job_items',
      'pod_listing_jobs',
    ]);
    const jobs = countStageQuery(plan.stages[2]);
    expect(flat(jobs)).toContain('COALESCE(j.finished_at, j.created_at) <');
    expect(flat(jobs)).toContain('NOT EXISTS');
    expect(jobs.values).toEqual(
      expect.arrayContaining([
        'COMPLETED',
        'COMPLETED_WITH_ERRORS',
        'FAILED',
        'CANCELLED',
        'PENDING',
        'PROCESSING',
        'RETRYING',
      ]),
    );
    // Không bao giờ dùng updated_at cho tuổi của Publish History.
    expect(flat(jobs)).not.toContain('updated_at');
  });

  it('DRAFT_LISTINGS: bỏ qua draft đã có id TikTok, đã lên sàn, đang publish / PUBLISHED / TIKTOK_DRAFT', () => {
    const plan = buildRetentionTaskPlan('DRAFT_LISTINGS', CUTOFF);
    expect(plan.stages.map((stage) => stage.table)).toEqual([
      'pod_listing_payload_items',
      'pod_listing_payloads',
    ]);
    const payloads = countStageQuery(plan.stages[1]);
    const text = flat(payloads);
    expect(text).toContain('x.went_live_at IS NULL');
    expect(text).toContain('x.tiktok_draft_id IS NULL');
    expect(text).toContain('x.tiktok_product_id IS NULL');
    expect(text).toContain('x.updated_at <');
    expect(payloads.values).toEqual(
      expect.arrayContaining(['DRAFT', 'READY', 'FAILED', 'ARCHIVED']),
    );
    expect(payloads.values).not.toContain('PUBLISHED');
    expect(payloads.values).not.toContain('PUBLISHING');
    expect(payloads.values).not.toContain('TIKTOK_DRAFT');
    expect(plan.kept.map((rule) => rule.reason)).toEqual(['ON_TIKTOK', 'IN_PROGRESS']);
  });

  it('🔴 lệnh xoá theo lô: LIMIT + SKIP LOCKED + kiểm lại điều kiện trên chính dòng bị xoá', () => {
    const plan = buildRetentionTaskPlan('DRAFT_LISTINGS', CUTOFF);
    const sql = deleteBatchQuery(plan.stages[1], 500);
    const text = flat(sql);
    expect(text).toMatch(
      /^DELETE FROM pod_listing_payloads t WHERE t\.id IN \(SELECT x\.id FROM pod_listing_payloads x/,
    );
    expect(text).toContain('FOR UPDATE OF x SKIP LOCKED');
    expect(text).toContain('t.tiktok_draft_id IS NULL');
    expect(sql.values).toContain(500);
  });
});
