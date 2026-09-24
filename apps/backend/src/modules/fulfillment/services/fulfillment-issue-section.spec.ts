import { FULFILLMENT_ISSUE_SECTIONS, READINESS_CODES, issueSectionOf } from './fulfillment-readiness.service';

/**
 * Mỗi lý do "chưa gửi được" phải biết mình thuộc KHỐI nào trên màn hình Fulfill — màn hình hiện
 * lỗi ngay tại chỗ cần sửa (Địa chỉ · Ánh xạ · Design · Nhà cung cấp), không dồn thành một cục.
 *
 * 🔴 Mã lạ phải rơi về `ORDER` (khối chung, luôn hiển thị) chứ không biến mất: một lỗi không được
 * gán khối mà bị giao diện bỏ qua là một lỗi người dùng không bao giờ đọc được.
 */
describe('issueSectionOf', () => {
  it('mọi mã lỗi của readiness đều được gán đúng khối', () => {
    expect(issueSectionOf(READINESS_CODES.ORDER_CANCELLED)).toBe('ORDER');
    expect(issueSectionOf(READINESS_CODES.NO_ITEMS)).toBe('ORDER');
    expect(issueSectionOf(READINESS_CODES.ADDRESS_MASKED)).toBe('ADDRESS');
    expect(issueSectionOf(READINESS_CODES.ADDRESS_INCOMPLETE)).toBe('ADDRESS');
    expect(issueSectionOf(READINESS_CODES.MAPPING_MISSING)).toBe('MAPPING');
    expect(issueSectionOf(READINESS_CODES.MAPPING_PROVIDER_MISMATCH)).toBe('MAPPING');
    expect(issueSectionOf(READINESS_CODES.DESIGN_MISSING)).toBe('DESIGN');
    expect(issueSectionOf(READINESS_CODES.DESIGN_NOT_PUBLIC)).toBe('DESIGN');
    expect(issueSectionOf(READINESS_CODES.PLACEMENT_UNSUPPORTED)).toBe('DESIGN');
  });

  it('lỗi cấu hình nhà cung cấp (do service dựng, không nằm trong READINESS_CODES) thuộc khối PROVIDER', () => {
    expect(issueSectionOf('PROVIDER_NOT_ASSIGNED')).toBe('PROVIDER');
    expect(issueSectionOf('PROVIDER_INACTIVE')).toBe('PROVIDER');
    expect(issueSectionOf('ACCOUNT_MISSING')).toBe('PROVIDER');
  });

  it('mã chưa khai báo ⇒ ORDER, và mọi giá trị trả về đều nằm trong danh sách khối hợp lệ', () => {
    expect(issueSectionOf('SOMETHING_NEW')).toBe('ORDER');
    for (const code of Object.values(READINESS_CODES)) {
      expect(FULFILLMENT_ISSUE_SECTIONS).toContain(issueSectionOf(code));
    }
  });
});
