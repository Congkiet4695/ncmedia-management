import { PodListingReviewStatus } from '@prisma/client';
import { joinAuditReasons, mapReviewStatus, toReviewSnapshot } from './pod-review-status.mapper';
import type { TiktokProductDetail } from '../../tiktok-sdk/types/tiktok-product.types';

/**
 * Ánh xạ trạng thái TikTok ⇒ trạng thái duyệt của hệ thống.
 *
 * 🔴 Đây là bảng luật, không phải một hàm tiện ích: đọc sai một ô là màn hình báo "đang duyệt"
 * cho một sản phẩm đã bị từ chối từ ba ngày trước, và người vận hành ngồi chờ một việc không
 * bao giờ tự xong.
 */
describe('mapReviewStatus — TikTok status + audit.status ⇒ review status', () => {
  it.each([
    ['ACTIVATE', undefined, PodListingReviewStatus.ACTIVE],
    ['DELETED', undefined, PodListingReviewStatus.DELETED],
    ['SELLER_DEACTIVATED', undefined, PodListingReviewStatus.OFFLINE],
    ['PLATFORM_DEACTIVATED', undefined, PodListingReviewStatus.OFFLINE],
    ['FREEZE', undefined, PodListingReviewStatus.OFFLINE],
    ['FAILED', undefined, PodListingReviewStatus.REJECTED],
    ['SCHEDULED', undefined, PodListingReviewStatus.APPROVED],
    ['PENDING', 'AUDITING', PodListingReviewStatus.UNDER_REVIEW],
    ['PENDING', undefined, PodListingReviewStatus.UNDER_REVIEW],
  ])('status=%s audit=%s ⇒ %s', (status, audit, expected) => {
    expect(mapReviewStatus(status, audit)).toBe(expected);
  });

  it('🔴 PENDING + PRE_APPROVED là ĐÃ QUA DUYỆT, không phải đang duyệt', () => {
    // Khác biệt thật: PRE_APPROVED nghĩa là TikTok đã duyệt xong, sản phẩm chưa lên sàn vì
    // còn thiếu điều kiện của CHÍNH NGƯỜI BÁN (KYC, quyền danh mục). Báo "đang duyệt" là
    // bảo người ta ngồi chờ TikTok trong khi việc đang nằm ở phía họ.
    expect(mapReviewStatus('PENDING', 'PRE_APPROVED')).toBe(PodListingReviewStatus.APPROVED);
    expect(mapReviewStatus('PENDING', 'APPROVED')).toBe(PodListingReviewStatus.APPROVED);
  });

  it('🔴 DRAFT / INITIAL ⇒ null — publish CHƯA có tác dụng, không tô màu "đang duyệt"', () => {
    expect(mapReviewStatus('DRAFT', 'NONE')).toBeNull();
    expect(mapReviewStatus('INITIAL', undefined)).toBeNull();
  });

  it('status trống ⇒ đọc riêng audit.status', () => {
    expect(mapReviewStatus(undefined, 'AUDITING')).toBe(PodListingReviewStatus.UNDER_REVIEW);
    expect(mapReviewStatus(undefined, 'FAILED')).toBe(PodListingReviewStatus.REJECTED);
    expect(mapReviewStatus(null, 'APPROVED')).toBe(PodListingReviewStatus.APPROVED);
  });

  it('🔴 Giá trị LẠ ⇒ null, không đoán bừa', () => {
    // TikTok thêm trạng thái mới là chuyện xảy ra thật. Đoán bừa sang UNDER_REVIEW thì màn
    // hình nói dối một cách thuyết phục; trả null thì cột `review_status_raw` vẫn giữ chuỗi
    // gốc và nhìn database là biết phải bổ sung nhánh nào.
    expect(mapReviewStatus('SOME_NEW_STATUS', 'SOMETHING_ELSE')).toBeNull();
    expect(mapReviewStatus(undefined, undefined)).toBeNull();
  });
});

describe('joinAuditReasons — lý do trượt duyệt', () => {
  it('gộp cả lý do lẫn hướng dẫn sửa, kèm vị trí', () => {
    const product: TiktokProductDetail = {
      auditFailedReasons: [
        { position: 'main_images', reasons: ['Ảnh mờ'], suggestions: ['Dùng ảnh ≥ 800px'] },
        { position: 'title', reasons: ['Tiêu đề chứa từ cấm'] },
      ],
    };

    expect(joinAuditReasons(product)).toBe(
      'main_images: Ảnh mờ — Dùng ảnh ≥ 800px · title: Tiêu đề chứa từ cấm',
    );
  });

  it('PRE_APPROVED cũng được nêu ra — "chưa lên sàn vì còn thiếu gì đó"', () => {
    const product: TiktokProductDetail = {
      audit: { status: 'PRE_APPROVED', preApprovedReasons: ['KYC_PENDING'] },
    };
    expect(joinAuditReasons(product)).toBe('KYC_PENDING');
  });

  it('không có lý do ⇒ null (không trả chuỗi rỗng)', () => {
    expect(joinAuditReasons({})).toBeNull();
    expect(joinAuditReasons({ auditFailedReasons: [{ position: 'x' }] })).toBeNull();
  });
});

describe('toReviewSnapshot', () => {
  it('giữ NGUYÊN chuỗi trạng thái gốc để đối chiếu về sau', () => {
    const snapshot = toReviewSnapshot({
      status: 'ACTIVATE',
      productStatus: 'ACTIVATE',
      audit: { status: 'APPROVED' },
    });

    expect(snapshot).toEqual({
      status: PodListingReviewStatus.ACTIVE,
      raw: 'ACTIVATE',
      reason: null,
    });
  });

  it('status trống thì `raw` lấy `product_status` — vẫn còn dấu vết để tra', () => {
    expect(toReviewSnapshot({ productStatus: 'FREEZE' }).raw).toBe('FREEZE');
  });
});
