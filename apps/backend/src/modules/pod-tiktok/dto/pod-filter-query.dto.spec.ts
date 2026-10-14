import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PodDashboardRangeDto } from './pod-dashboard.dto';
import { PodTiktokAccountQueryDto } from './pod-tiktok-query.dto';

/** Tham số query mới (2026-10-14): `allTime` của Dashboard; `shopStatus` / `sellerId` của TikTok Accounts. */
const errorsOf = <T extends object>(cls: new () => T, plain: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, plain)).map((error) => error.property);

describe('PodDashboardRangeDto.allTime', () => {
  it('"true" (query string) ⇒ true; bỏ trống ⇒ false', () => {
    expect(plainToInstance(PodDashboardRangeDto, { allTime: 'true' }).allTime).toBe(true);
    expect(plainToInstance(PodDashboardRangeDto, { allTime: 'false' }).allTime).toBe(false);
    expect(plainToInstance(PodDashboardRangeDto, {}).allTime).toBe(false);
    expect(errorsOf(PodDashboardRangeDto, { allTime: 'true' })).toEqual([]);
  });
});

describe('PodTiktokAccountQueryDto — bộ lọc mới', () => {
  it.each(['ACTIVE', 'INACTIVE'])('shopStatus=%s hợp lệ', (shopStatus) => {
    expect(errorsOf(PodTiktokAccountQueryDto, { shopStatus })).toEqual([]);
  });

  it('shopStatus lạ ⇒ lỗi validate', () => {
    expect(errorsOf(PodTiktokAccountQueryDto, { shopStatus: 'LIVE' })).toEqual(['shopStatus']);
  });

  it('sellerId: UUID hoặc UNASSIGNED; giá trị khác ⇒ lỗi (không lọt chuỗi tuỳ ý xuống truy vấn)', () => {
    expect(errorsOf(PodTiktokAccountQueryDto, { sellerId: '0f8fad5b-d9cb-469f-a165-70867728950e' })).toEqual([]);
    expect(errorsOf(PodTiktokAccountQueryDto, { sellerId: 'UNASSIGNED' })).toEqual([]);
    expect(errorsOf(PodTiktokAccountQueryDto, { sellerId: "x' OR 1=1" })).toEqual(['sellerId']);
  });
});
