import { retentionCutoff } from './data-retention-cutoff';

/**
 * Mốc giữ lại theo NGÀY NGHIỆP VỤ (America/Los_Angeles) — không theo múi giờ server, không cộng 24 giờ.
 */
const LA = 'America/Los_Angeles';

describe('retentionCutoff', () => {
  it('keepDays = 1 ⇒ mốc là 00:00 HÔM NAY ở Los Angeles (PDT, UTC−7)', () => {
    // 2026-10-29 15:00 UTC = 08:00 PDT ngày 29.
    const { keepFromDay, cutoff } = retentionCutoff(new Date('2026-10-29T15:00:00Z'), LA, 1);
    expect(keepFromDay).toBe('2026-10-29');
    expect(cutoff.toISOString()).toBe('2026-10-29T07:00:00.000Z');
  });

  it('🔴 ranh giới ngày tính theo LA, không theo UTC: 03:00 UTC ngày 30 vẫn là ngày 29 ở LA', () => {
    const { keepFromDay, cutoff } = retentionCutoff(new Date('2026-10-30T03:00:00Z'), LA, 1);
    expect(keepFromDay).toBe('2026-10-29');
    expect(cutoff.toISOString()).toBe('2026-10-29T07:00:00.000Z');
  });

  it('thời điểm chuyển ngày: 00:00:00 LA ⇒ ngày mới; 23:59:59 LA ⇒ vẫn ngày cũ', () => {
    expect(retentionCutoff(new Date('2026-10-30T07:00:00Z'), LA, 1).keepFromDay).toBe('2026-10-30');
    expect(retentionCutoff(new Date('2026-10-30T06:59:59Z'), LA, 1).keepFromDay).toBe('2026-10-29');
  });

  it('keepDays = 7 ⇒ giữ hôm nay + 6 ngày trước (tính theo ngày lịch)', () => {
    const { keepFromDay, cutoff } = retentionCutoff(new Date('2026-10-29T15:00:00Z'), LA, 7);
    expect(keepFromDay).toBe('2026-10-23');
    expect(cutoff.toISOString()).toBe('2026-10-23T07:00:00.000Z');
  });

  it('🔴 đi qua mốc đổi giờ mùa đông (01/11/2026): mốc vẫn đúng 00:00 PDT của ngày giữ đầu tiên', () => {
    // 2026-11-03 12:00 UTC = 04:00 PST. Giữ 7 ngày ⇒ từ 2026-10-28 00:00 PDT (UTC−7).
    const { keepFromDay, cutoff } = retentionCutoff(new Date('2026-11-03T12:00:00Z'), LA, 7);
    expect(keepFromDay).toBe('2026-10-28');
    expect(cutoff.toISOString()).toBe('2026-10-28T07:00:00.000Z');
    // Ngày ngay sau khi đổi giờ: 00:00 PST = 08:00 UTC.
    expect(retentionCutoff(new Date('2026-11-02T12:00:00Z'), LA, 1).cutoff.toISOString()).toBe(
      '2026-11-02T08:00:00.000Z',
    );
  });

  it('đổi giờ mùa hè (08/03/2026): ngày 23 giờ — 00:00 ngày 09 là 07:00 UTC', () => {
    expect(retentionCutoff(new Date('2026-03-09T12:00:00Z'), LA, 1).cutoff.toISOString()).toBe(
      '2026-03-09T07:00:00.000Z',
    );
    expect(retentionCutoff(new Date('2026-03-08T12:00:00Z'), LA, 1).cutoff.toISOString()).toBe(
      '2026-03-08T08:00:00.000Z',
    );
  });

  it('múi giờ khác cho ra mốc khác — không bao giờ dùng múi giờ của server', () => {
    const at = new Date('2026-10-29T20:00:00Z');
    expect(retentionCutoff(at, 'Asia/Ho_Chi_Minh', 1).cutoff.toISOString()).toBe(
      '2026-10-29T17:00:00.000Z',
    );
    expect(retentionCutoff(at, 'UTC', 1).cutoff.toISOString()).toBe('2026-10-29T00:00:00.000Z');
  });

  it('số ngày giữ không hợp lệ ⇒ RangeError (không bao giờ xoá với mốc vô nghĩa)', () => {
    expect(() => retentionCutoff(new Date(), LA, 0)).toThrow(RangeError);
    expect(() => retentionCutoff(new Date(), LA, 1.5)).toThrow(RangeError);
  });
});
