import { OrganizationStatus } from '@prisma/client';
import { OrganizationDeactivatedException } from '../exceptions/organization-deactivated.exception';
import { OrganizationExpiredException } from '../exceptions/organization-expired.exception';
import { OrganizationInactiveException } from '../exceptions/organization-inactive.exception';
import { OrganizationPendingApprovalException } from '../exceptions/organization-pending-approval.exception';
import { OrganizationRejectedException } from '../exceptions/organization-rejected.exception';
import { assertOrganizationAccess, organizationAccessDenial } from './organization-access';

/** Luật DUY NHẤT cho login, `/me`, refresh và JwtAuthGuard — một hồi quy ở đây mở cửa cho cả bốn. */
describe('organizationAccessDenial', () => {
  const NOW = new Date('2026-11-11T00:00:00.000Z');
  const future = new Date('2026-12-01T00:00:00.000Z');
  const past = new Date('2026-11-01T00:00:00.000Z');
  const org = (status: OrganizationStatus, expiresAt: Date | null, isPlatform = false) => ({
    status,
    expiresAt,
    isPlatform,
  });

  it.each([
    [OrganizationStatus.ACTIVE, future, null],
    [OrganizationStatus.TRIAL, future, null],
    [OrganizationStatus.ACTIVE, null, null],
    [OrganizationStatus.ACTIVE, past, 'EXPIRED'],
    [OrganizationStatus.TRIAL, past, 'EXPIRED'],
    [OrganizationStatus.SUSPENDED, future, 'DEACTIVATED'],
    [OrganizationStatus.SUSPENDED, past, 'DEACTIVATED'],
    [OrganizationStatus.PENDING, null, 'PENDING'],
    [OrganizationStatus.REJECTED, null, 'REJECTED'],
    [OrganizationStatus.DELETED, future, 'INACTIVE'],
  ] as const)('%s + expires_at=%s ⇒ %s', (status, expiresAt, expected) => {
    expect(organizationAccessDenial(org(status, expiresAt), NOW)).toBe(expected);
  });

  it('🔴 vô hiệu hoá được xét TRƯỚC hạn: gia hạn không tự mở khoá', () => {
    expect(organizationAccessDenial(org(OrganizationStatus.SUSPENDED, future), NOW)).toBe(
      'DEACTIVATED',
    );
  });

  it('tổ chức hệ thống (Super Admin) không bị trạng thái / hạn của tenant giới hạn', () => {
    expect(organizationAccessDenial(org(OrganizationStatus.ACTIVE, past, true), NOW)).toBeNull();
    expect(organizationAccessDenial(org(OrganizationStatus.SUSPENDED, past, true), NOW)).toBeNull();
  });

  it.each([
    [OrganizationStatus.PENDING, null, OrganizationPendingApprovalException],
    [OrganizationStatus.REJECTED, null, OrganizationRejectedException],
    [OrganizationStatus.SUSPENDED, future, OrganizationDeactivatedException],
    [OrganizationStatus.ACTIVE, past, OrganizationExpiredException],
    [OrganizationStatus.DELETED, null, OrganizationInactiveException],
  ] as const)('%s ⇒ exception riêng', (status, expiresAt, exception) => {
    expect(() => assertOrganizationAccess(org(status, expiresAt), NOW)).toThrow(exception);
  });

  it('thông điệp đúng yêu cầu (EXPIRED / DEACTIVATED)', () => {
    expect(new OrganizationExpiredException().getResponse()).toEqual({
      code: 'AUTH_ORGANIZATION_EXPIRED',
      message: 'Gói của tổ chức đã hết hạn, vui lòng liên hệ admin.',
    });
    expect(new OrganizationDeactivatedException().getResponse()).toEqual({
      code: 'AUTH_ORGANIZATION_DEACTIVATED',
      message: 'Tổ chức của bạn hiện đang bị vô hiệu hóa. Vui lòng liên hệ Super Admin.',
    });
  });
});
