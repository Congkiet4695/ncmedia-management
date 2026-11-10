import {
  defaultExpiresAt,
  exceedsShopLimit,
  isOrganizationExpiredAt,
  ORGANIZATION_DEFAULT_SHOP_LIMIT,
  ORGANIZATION_DEFAULT_TERM_DAYS,
} from './organization-plan';

describe('organization-plan', () => {
  it('mặc định khi duyệt lần đầu: 10 Shop, 30 ngày', () => {
    expect(ORGANIZATION_DEFAULT_SHOP_LIMIT).toBe(10);
    expect(ORGANIZATION_DEFAULT_TERM_DAYS).toBe(30);
  });

  it('🔴 hết hạn mặc định = NGÀY ĐĂNG KÝ + 30 ngày (đăng ký 01/11/2026 ⇒ 01/12/2026, bất kể ngày duyệt)', () => {
    expect(defaultExpiresAt(new Date('2026-11-01T00:00:00.000Z')).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
    // Giữ nguyên giờ đăng ký — không làm tròn ngày, không múi giờ riêng.
    expect(defaultExpiresAt(new Date('2026-11-01T17:45:10.123Z')).toISOString()).toBe(
      '2026-12-01T17:45:10.123Z',
    );
  });

  describe('isOrganizationExpiredAt — hết hạn khi now >= expires_at', () => {
    const at = new Date('2026-12-01T00:00:00.000Z');
    it.each([
      ['trước 1ms', new Date(at.getTime() - 1), false],
      ['đúng thời điểm', at, true],
      ['sau', new Date(at.getTime() + 1), true],
    ])('%s ⇒ %s', (_label, now, expected) => {
      expect(isOrganizationExpiredAt(at, now)).toBe(expected);
    });

    it('NULL / undefined = không hết hạn', () => {
      expect(isOrganizationExpiredAt(null)).toBe(false);
      expect(isOrganizationExpiredAt(undefined)).toBe(false);
    });
  });

  describe('exceedsShopLimit', () => {
    it.each([
      [{ before: 3, after: 4, limit: 10 }, false, '3/10 + 1'],
      [{ before: 9, after: 10, limit: 10 }, false, '9/10 + 1 ⇒ đúng bằng giới hạn'],
      [{ before: 10, after: 11, limit: 10 }, true, '10/10 + 1'],
      [{ before: 9, after: 11, limit: 10 }, true, '9/10 + 2 (một lần uỷ quyền nhiều shop)'],
      [
        { before: 15, after: 15, limit: 10 },
        false,
        'đang vượt (giới hạn vừa hạ) nhưng KHÔNG thêm shop',
      ],
      [{ before: 15, after: 14, limit: 10 }, false, 'giảm shop'],
      [{ before: 500, after: 600, limit: null }, false, 'không giới hạn'],
    ] as Array<[{ before: number; after: number; limit: number | null }, boolean, string]>)(
      '%j ⇒ %s (%s)',
      (input, expected) => {
        expect(exceedsShopLimit(input)).toBe(expected);
      },
    );
  });
});
