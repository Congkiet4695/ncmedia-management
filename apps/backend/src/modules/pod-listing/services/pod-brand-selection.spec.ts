import { PodBrandMode } from '@prisma/client';
import { POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID } from '../../pod-product/constants/pod-product.constants';
import { hasBrandSelection, normalizeBrandSelection } from './pod-brand-selection';
import { resolveTiktokBrandId } from './pod-listing-publisher.service';

/**
 * Unit test — lựa chọn thương hiệu, hai đầu của luồng.
 *
 * 🔴 Bộ test này canh gác đúng một câu: **"No brand" là ý định của người dùng và phải sống
 * sót nguyên vẹn tới payload gửi TikTok.** Mỗi nhánh dưới đây ứng với một cách lỗi cũ đã
 * xảy ra hoặc có thể tái diễn:
 *
 *   - chọn "No brand" → template lưu id bịa → TikTok gán thương hiệu lạ;
 *   - chọn "No brand" → validator chặn oan vì `tiktokBrandId` null;
 *   - draft cũ (đóng băng trước khi sửa) vẫn mang id bịa khi publish/retry.
 */

describe('normalizeBrandSelection', () => {
  it('NONE ⇒ xoá sạch id, giữ tên hiển thị "No brand"', () => {
    expect(
      normalizeBrandSelection({ brandMode: PodBrandMode.NONE, tiktokBrandId: 'brand-9' }),
    ).toEqual({ brandMode: PodBrandMode.NONE, tiktokBrandId: null, brandName: 'No brand' });
  });

  it('SPECIFIC kèm id ⇒ giữ nguyên', () => {
    expect(
      normalizeBrandSelection({
        brandMode: PodBrandMode.SPECIFIC,
        tiktokBrandId: 'brand-9',
        brandName: 'Nike',
      }),
    ).toEqual({ brandMode: PodBrandMode.SPECIFIC, tiktokBrandId: 'brand-9', brandName: 'Nike' });
  });

  it('SPECIFIC nhưng THIẾU id ⇒ hạ về UNSET để validator nói rõ, không publish âm thầm', () => {
    expect(normalizeBrandSelection({ brandMode: PodBrandMode.SPECIFIC })).toEqual({
      brandMode: PodBrandMode.UNSET,
      tiktokBrandId: null,
      brandName: null,
    });
  });

  it('🔴 nhận id BỊA "No brand" ⇒ quy về NONE, không ghi tiếp cái sai xuống database', () => {
    expect(
      normalizeBrandSelection({ tiktokBrandId: POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID }),
    ).toEqual({ brandMode: PodBrandMode.NONE, tiktokBrandId: null, brandName: 'No brand' });
  });

  it('client CŨ gửi id mà không gửi brandMode ⇒ suy ra SPECIFIC (tương thích ngược)', () => {
    expect(normalizeBrandSelection({ tiktokBrandId: 'brand-9', brandName: 'Nike' })).toEqual({
      brandMode: PodBrandMode.SPECIFIC,
      tiktokBrandId: 'brand-9',
      brandName: 'Nike',
    });
  });

  it('client CŨ không gửi gì ⇒ UNSET', () => {
    expect(normalizeBrandSelection({})).toEqual({
      brandMode: PodBrandMode.UNSET,
      tiktokBrandId: null,
      brandName: null,
    });
  });

  it('id toàn khoảng trắng ⇒ UNSET, không lưu chuỗi rỗng', () => {
    expect(normalizeBrandSelection({ tiktokBrandId: '   ' })).toEqual({
      brandMode: PodBrandMode.UNSET,
      tiktokBrandId: null,
      brandName: null,
    });
  });
});

describe('hasBrandSelection', () => {
  it('request KHÔNG đụng tới brand ⇒ false (PATCH đổi tên không được reset "No brand")', () => {
    expect(hasBrandSelection({})).toBe(false);
  });

  it.each([
    ['brandMode', { brandMode: PodBrandMode.NONE }],
    ['tiktokBrandId', { tiktokBrandId: 'brand-9' }],
    ['brandName', { brandName: 'Nike' }],
  ])('request có gửi %s ⇒ true', (_label, input) => {
    expect(hasBrandSelection(input)).toBe(true);
  });
});

describe('resolveTiktokBrandId — cổng chặn cuối trước khi gửi TikTok', () => {
  it('NONE ⇒ BỎ HẲN brand_id khỏi payload', () => {
    expect(
      resolveTiktokBrandId({ mode: PodBrandMode.NONE, tiktokBrandId: null, name: 'No brand' }),
    ).toBeUndefined();
  });

  it('🔴 NONE mà payload vẫn còn sót id ⇒ vẫn bỏ (mode thắng id)', () => {
    expect(
      resolveTiktokBrandId({ mode: PodBrandMode.NONE, tiktokBrandId: 'brand-9', name: null }),
    ).toBeUndefined();
  });

  it('SPECIFIC ⇒ gửi đúng id người dùng chọn', () => {
    expect(
      resolveTiktokBrandId({ mode: PodBrandMode.SPECIFIC, tiktokBrandId: 'brand-9', name: 'Nike' }),
    ).toBe('brand-9');
  });

  it('UNSET ⇒ không gửi gì (validator đã chặn từ trước)', () => {
    expect(
      resolveTiktokBrandId({ mode: PodBrandMode.UNSET, tiktokBrandId: null, name: null }),
    ).toBeUndefined();
  });

  it('🔴 DRAFT CŨ: payload đóng băng không có `mode` nhưng mang id BỊA ⇒ vẫn bị chặn', () => {
    expect(
      resolveTiktokBrandId({
        tiktokBrandId: POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID,
        name: 'No brand',
      }),
    ).toBeUndefined();
  });

  it('DRAFT CŨ: payload không có `mode` nhưng mang brand THẬT ⇒ giữ nguyên, không phá', () => {
    expect(resolveTiktokBrandId({ tiktokBrandId: 'brand-9', name: 'Nike' })).toBe('brand-9');
  });
});
