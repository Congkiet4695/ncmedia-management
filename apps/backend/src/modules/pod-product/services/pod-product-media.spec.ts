import { PodProductMediaFailedException, PodProductMediaService } from './pod-product-media.service';
import { TIKTOK_IMAGE_USE_CASE } from '../../tiktok-sdk/tiktok-sdk.constants';

/**
 * **Đưa ảnh/video lên TikTok trước khi sửa sản phẩm.**
 *
 * 🔴 Vì sao bộ test này tồn tại: bước này quyết định bộ ảnh CUỐI CÙNG của một sản phẩm đang
 * bán. Ba kiểu sai đều im lặng:
 *   - Đảo thứ tự trong lúc upload song song ⇒ đổi luôn ảnh đại diện.
 *   - Bỏ qua một tấm upload hỏng ⇒ gửi bộ ảnh thiếu, tức XOÁ tấm đó khỏi sản phẩm.
 *   - Upload lại tấm TikTok đã có ⇒ đốt hạn mức, và với bộ mockup dùng cho hàng nghìn
 *     listing thì con số đó không nhỏ.
 */

const CTX = { accessToken: 'token', shopCipher: 'cipher' } as never;
const ORG = 'org-1';

function setup(over: {
  upload?: jest.Mock;
  uploadFile?: jest.Mock;
  cachedRows?: Array<{ fileId: string; tiktokImageUri: string | null }>;
} = {}) {
  const uploadImage =
    over.upload ??
    jest.fn((_ctx: unknown, image: { fileName: string }) =>
      Promise.resolve({ data: { uri: `uri-of-${image.fileName}` } }),
    );
  const uploadFile = over.uploadFile ?? jest.fn(() => Promise.resolve({ data: { id: 'video-new' } }));
  const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));

  const prisma = {
    podImageTemplateItem: {
      findMany: jest.fn(() => Promise.resolve(over.cachedRows ?? [])),
      updateMany,
    },
  };
  const storage = {
    download: jest.fn((_org: string, fileId: string) =>
      Promise.resolve({
        file: { originalName: `${fileId}.jpg`, mimeType: 'image/jpeg' },
        body: Buffer.from(fileId),
      }),
    ),
  };

  const service = new PodProductMediaService(
    prisma as never,
    storage as never,
    { uploadImage, uploadFile } as never,
  );

  return { service, uploadImage, uploadFile, updateMany, prisma, storage };
}

describe('PodProductMediaService — ảnh sản phẩm', () => {
  it('ảnh đã có `uri` ⇒ KHÔNG upload lại', async () => {
    const { service, uploadImage, storage } = setup();

    const result = await service.resolveImages(ORG, CTX, [{ uri: 'img-a' }, { uri: 'img-b' }]);

    expect(result).toEqual(['img-a', 'img-b']);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('🔴 GIỮ NGUYÊN thứ tự khi vừa có ảnh cũ vừa có ảnh mới', async () => {
    const { service } = setup();

    // Ảnh mới chèn vào GIỮA — nếu gom ảnh upload về cuối thì ảnh đại diện vẫn đúng nhưng
    // thứ tự hiển thị sai, và đó là lỗi không ai nhìn thấy cho tới khi mở Seller Center.
    const result = await service.resolveImages(ORG, CTX, [
      { uri: 'img-a' },
      { fileId: 'file-new' },
      { uri: 'img-b' },
    ]);

    expect(result).toEqual(['img-a', 'uri-of-file-new.jpg', 'img-b']);
  });

  it('🔴 ảnh mới ở vị trí ĐẦU vẫn nằm đầu — nó là ảnh đại diện', async () => {
    const { service } = setup();

    const result = await service.resolveImages(ORG, CTX, [{ fileId: 'file-x' }, { uri: 'img-a' }]);

    expect(result[0]).toBe('uri-of-file-x.jpg');
  });

  it('🔴 dùng lại `uri` đã cache của bộ ảnh mẫu thay vì upload lần nữa', async () => {
    const { service, uploadImage } = setup({
      cachedRows: [{ fileId: 'file-mockup', tiktokImageUri: 'uri-cached' }],
    });

    const result = await service.resolveImages(ORG, CTX, [{ fileId: 'file-mockup' }]);

    expect(result).toEqual(['uri-cached']);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('upload xong thì ghi `uri` lại vào bộ ảnh mẫu để lần sau khỏi upload', async () => {
    const { service, updateMany } = setup();

    await service.resolveImages(ORG, CTX, [{ fileId: 'file-new' }]);

    const [args] = updateMany.mock.calls as unknown as [
      [{ where: { organizationId: string; fileId: string }; data: { tiktokImageUri: string } }],
    ];
    expect(args[0].where).toMatchObject({ organizationId: ORG, fileId: 'file-new' });
    expect(args[0].data.tiktokImageUri).toBe('uri-of-file-new.jpg');
  });

  it('🔴 MỘT tấm hỏng ⇒ ném lỗi, KHÔNG trả về bộ ảnh thiếu', async () => {
    const upload = jest.fn((_ctx: unknown, image: { fileName: string }) =>
      image.fileName === 'file-bad.jpg'
        ? Promise.reject(new Error('File quá lớn'))
        : Promise.resolve({ data: { uri: `uri-of-${image.fileName}` } }),
    );
    const { service } = setup({ upload });

    await expect(
      service.resolveImages(ORG, CTX, [{ uri: 'img-a' }, { fileId: 'file-bad' }]),
    ).rejects.toBeInstanceOf(PodProductMediaFailedException);
  });

  it('lỗi nói RÕ tấm nào và vì sao', async () => {
    const upload = jest.fn(() => Promise.reject(new Error('File quá lớn')));
    const { service } = setup({ upload });

    await service
      .resolveImages(ORG, CTX, [{ uri: 'img-a' }, { fileId: 'file-bad' }])
      .then(
        () => {
          throw new Error('phải ném lỗi');
        },
        (error: { response: { code: string; failures: Array<{ label: string; message: string }> } }) => {
          expect(error.response.code).toBe('POD_PRODUCT_MEDIA_UPLOAD_FAILED');
          expect(error.response.failures).toEqual([
            { label: 'Ảnh 2', message: 'File quá lớn' },
          ]);
        },
      );
  });

  it('nhiều tấm hỏng ⇒ báo ĐỦ số lượng, không chỉ tấm đầu tiên', async () => {
    const upload = jest.fn(() => Promise.reject(new Error('hỏng')));
    const { service } = setup({ upload });

    await service.resolveImages(ORG, CTX, [{ fileId: 'a' }, { fileId: 'b' }]).catch(
      (error: { response: { failures: unknown[]; message: string } }) => {
        expect(error.response.failures).toHaveLength(2);
        expect(error.response.message).toContain('Chưa có thay đổi nào được lưu');
      },
    );
  });

  it('ảnh không có cả `uri` lẫn `fileId` ⇒ lỗi, không im lặng bỏ qua', async () => {
    const { service } = setup();
    await expect(service.resolveImages(ORG, CTX, [{}])).rejects.toBeInstanceOf(
      PodProductMediaFailedException,
    );
  });

  it('danh sách rỗng ⇒ không gọi gì cả', async () => {
    const { service, uploadImage, prisma } = setup();

    expect(await service.resolveImages(ORG, CTX, [])).toEqual([]);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(prisma.podImageTemplateItem.findMany).not.toHaveBeenCalled();
  });
});

describe('PodProductMediaService — bảng size', () => {
  it('🔴 upload với use case SIZE_CHART_IMAGE, không phải MAIN_IMAGE', async () => {
    const { service, uploadImage } = setup();

    await service.resolveSizeChart(ORG, CTX, { fileId: 'chart' });

    expect(uploadImage).toHaveBeenCalledWith(
      CTX,
      expect.anything(),
      TIKTOK_IMAGE_USE_CASE.SIZE_CHART_IMAGE,
    );
  });

  it('🔴 KHÔNG mượn `uri` đã cache của ảnh sản phẩm — cùng ảnh, khác use case, khác uri', async () => {
    const { service, uploadImage } = setup({
      cachedRows: [{ fileId: 'chart', tiktokImageUri: 'uri-cua-anh-san-pham' }],
    });

    const uri = await service.resolveSizeChart(ORG, CTX, { fileId: 'chart' });

    expect(uri).toBe('uri-of-chart.jpg');
    expect(uploadImage).toHaveBeenCalled();
  });

  it('bảng size đã có `uri` ⇒ dùng luôn', async () => {
    const { service, uploadImage } = setup();

    expect(await service.resolveSizeChart(ORG, CTX, { uri: 'chart-1' })).toBe('chart-1');
    expect(uploadImage).not.toHaveBeenCalled();
  });
});

describe('PodProductMediaService — video', () => {
  it('🔴 dùng Upload Product **File** và lấy `id`, không phải `uri`', async () => {
    const { service, uploadFile, uploadImage } = setup();

    expect(await service.resolveVideo(ORG, CTX, 'file-video')).toBe('video-new');
    expect(uploadFile).toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('TikTok không trả `id` ⇒ lỗi, không coi là thành công', async () => {
    const { service } = setup({ uploadFile: jest.fn(() => Promise.resolve({ data: {} })) });

    await expect(service.resolveVideo(ORG, CTX, 'file-video')).rejects.toBeInstanceOf(
      PodProductMediaFailedException,
    );
  });
});
