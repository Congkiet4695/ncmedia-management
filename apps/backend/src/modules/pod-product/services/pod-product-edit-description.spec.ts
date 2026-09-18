import { BadRequestException } from '@nestjs/common';
import { PodDescriptionImageException } from './pod-description-image.service';
import { PodProductEditService } from './pod-product-edit.service';

/**
 * Edit Product: mô tả có ảnh mới ⇒ ảnh upload với DESCRIPTION_IMAGE trước khi diff/partial_edit;
 * ảnh đang có trên sản phẩm TikTok giữ nguyên; hỏng ⇒ 400 rõ ràng, không gửi gì lên sàn.
 */
function buildService(normalize: jest.Mock) {
  const media = {
    resolveImages: jest.fn(),
    resolveSizeChart: jest.fn(),
    resolveVideo: jest.fn(),
  };
  const service = new PodProductEditService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    media as never,
    { normalize } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  // `resolveMedia` là private — gọi qua chỉ mục để test đúng bước chuẩn hoá mô tả.
  const resolveMedia = (dto: Record<string, unknown>, current: string | null) =>
    (service as unknown as {
      resolveMedia: (o: string, c: unknown, d: unknown, cur: string | null) => Promise<{ description?: string }>;
    }).resolveMedia('org-1', { shopId: 's' }, dto, current);
  return { resolveMedia, normalize };
}

describe('PodProductEditService — ảnh trong mô tả khi sửa sản phẩm', () => {
  it('mô tả đổi ⇒ chuẩn hoá với bộ ảnh ĐANG có trên sản phẩm làm tập đã-hợp-lệ', async () => {
    const normalize = jest.fn().mockResolvedValue({
      html: '<img src="https://tt/old"><img src="https://tt/new" width="1" height="1">',
      stats: { total: 2, uploaded: 1, reused: 1, failed: 0, finalCount: 2 },
    });
    const { resolveMedia } = buildService(normalize);

    const input = await resolveMedia(
      { description: '<img src="https://tt/old"><img src="https://cdn.ncmedia.test/new.jpg">' },
      '<p>cũ</p><img src="https://tt/old">',
    );

    expect(input.description).toBe('<img src="https://tt/old"><img src="https://tt/new" width="1" height="1">');
    const options = (normalize.mock.calls[0] as unknown[])[3] as { knownTiktokUrls: Set<string> };
    expect([...options.knownTiktokUrls]).toEqual(['https://tt/old']);
  });

  it('không gửi mô tả ⇒ không chuẩn hoá gì', async () => {
    const { resolveMedia, normalize } = buildService(jest.fn());
    await resolveMedia({ title: 'x' }, '<img src="https://tt/old">');
    expect(normalize).not.toHaveBeenCalled();
  });

  it('upload ảnh mô tả hỏng ⇒ 400 POD_PRODUCT_DESCRIPTION_IMAGE_FAILED, chưa đụng tới sàn', async () => {
    const { resolveMedia } = buildService(
      jest.fn().mockRejectedValue(new PodDescriptionImageException('Không thể upload ảnh trong mô tả lên TikTok Shop. Vui lòng thử lại.')),
    );
    await expect(resolveMedia({ description: '<img src="https://cdn.ncmedia.test/a.jpg">' }, null)).rejects.toMatchObject({
      response: { code: 'POD_PRODUCT_DESCRIPTION_IMAGE_FAILED' },
    });
    await expect(resolveMedia({ description: '<img src="https://cdn.ncmedia.test/a.jpg">' }, null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
