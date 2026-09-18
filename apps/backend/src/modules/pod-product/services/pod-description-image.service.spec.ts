import {
  classifyImageSource,
  extractDescriptionImages,
  findUnsendableDescriptionImages,
  rewriteDescriptionImages,
} from './description-images';
import {
  DESCRIPTION_IMAGE_UPLOAD_FAILED_MESSAGE,
  PodDescriptionImageException,
  PodDescriptionImageService,
  knownDescriptionImageUrls,
} from './pod-description-image.service';

/**
 * Ảnh trong MÔ TẢ sản phẩm phải là URL do Upload Product Image (`use_case = DESCRIPTION_IMAGE`)
 * trả về — lỗi TikTok `12052340`.
 *
 * 🔴 Ba bất biến được canh:
 *   1. Ảnh mô tả upload với ĐÚNG `DESCRIPTION_IMAGE`, không bao giờ là MAIN_IMAGE.
 *   2. "Đã upload chưa" trả lời bằng metadata (bảng mapping / bộ ảnh đang có trên sản phẩm),
 *      không đoán theo tiền tố URL — và không upload lại thứ đã có.
 *   3. Hỏng một ảnh ⇒ ném lỗi, KHÔNG trả về HTML nửa vời để nơi gọi gửi đi.
 */

const CTX = { accessToken: 'secret', shopCipher: 'c', shopId: 'shop-1', organizationId: 'org-1' };
const CDN = 'https://cdn.ncmedia.test/uploads';

describe('description-images (thuần)', () => {
  it('tìm mọi <img> theo thứ tự, đọc src/width/height, chịu được thẻ tự đóng và nháy đơn', () => {
    const html =
      `<p>a</p><img src="${CDN}/1.jpg" alt="x"><img src='${CDN}/2.jpg' width="10" height='20' />` +
      `<IMG SRC="${CDN}/3.jpg" style="max-width:100%">`;
    const refs = extractDescriptionImages(html);
    expect(refs.map((ref) => [ref.index, ref.src, ref.width, ref.height])).toEqual([
      [0, `${CDN}/1.jpg`, null, null],
      [1, `${CDN}/2.jpg`, '10', '20'],
      [2, `${CDN}/3.jpg`, null, null],
    ]);
  });

  it('phân loại src: http · data · blob · rỗng · lạ', () => {
    expect(classifyImageSource('https://a/b.jpg')).toBe('HTTP');
    expect(classifyImageSource('data:image/png;base64,AAA')).toBe('DATA');
    expect(classifyImageSource('blob:https://app/uuid')).toBe('BLOB');
    expect(classifyImageSource('  ')).toBe('EMPTY');
    expect(classifyImageSource('/local/path.jpg')).toBe('OTHER');
  });

  it('🔴 đổi src sang URL TikTok, ĐẶT width/height thật, giữ nguyên alt/style và thẻ tự đóng', () => {
    const html = `<p>x</p><img src="${CDN}/1.jpg" alt="mô tả" style="max-width:100%" width="9" height="9" /><img src="${CDN}/2.jpg">`;
    const out = rewriteDescriptionImages(html, (ref) =>
      ref.src.endsWith('1.jpg')
        ? { url: 'https://p16-oec.tiktokcdn.com/tos/abc~tplv.jpeg', width: 1600, height: 1600 }
        : null,
    );
    expect(out).toBe(
      `<p>x</p><img src="https://p16-oec.tiktokcdn.com/tos/abc~tplv.jpeg" alt="mô tả" style="max-width:100%" width="1600" height="1600" /><img src="${CDN}/2.jpg">`,
    );
  });

  it('không bịa kích thước: TikTok không trả width/height ⇒ giữ thuộc tính cũ (nếu có)', () => {
    const out = rewriteDescriptionImages(`<img src="${CDN}/1.jpg" width="640">`, () => ({
      url: 'https://tt/1',
      width: null,
      height: null,
    }));
    expect(out).toBe('<img src="https://tt/1" width="640">');
  });

  it('lỗi hình thức: data:/blob:/rỗng/lạ bị bắt kèm số thứ tự ảnh; http(s) thì không', () => {
    const problems = findUnsendableDescriptionImages(
      `<img src="data:image/png;base64,x"><img src="${CDN}/ok.jpg"><img src=""><img src="blob:x">`,
    );
    expect(problems.map((problem) => [problem.index, problem.reason])).toEqual([
      [0, 'DATA_URL'],
      [2, 'EMPTY'],
      [3, 'BLOB_URL'],
    ]);
  });

  it('knownDescriptionImageUrls: ảnh http(s) đang có trên mô tả TikTok của sản phẩm', () => {
    expect([...knownDescriptionImageUrls('<img src="https://tt/a"><img src="data:x">')]).toEqual([
      'https://tt/a',
    ]);
    expect(knownDescriptionImageUrls(null).size).toBe(0);
  });
});

/** Prisma giả: bảng mapping trong bộ nhớ + bảng storage_files với public_url/checksum. */
function buildService(options: {
  storageFiles?: Array<{ id: string; publicUrl: string; checksum: string | null }>;
  mappings?: Array<{ sourceKey: string; checksum?: string | null; tiktokUrl: string; width?: number; height?: number }>;
  uploadImpl?: (image: { fileName: string }, useCase: string) => Promise<unknown>;
} = {}) {
  const mappings = (options.mappings ?? []).map((row) => ({
    organizationId: 'org-1',
    sourceKey: row.sourceKey,
    checksum: row.checksum ?? null,
    tiktokUrl: row.tiktokUrl,
    width: row.width ?? null,
    height: row.height ?? null,
  }));
  const storageFiles = options.storageFiles ?? [];
  let counter = 0;

  const prisma = {
    podTiktokDescriptionImage: {
      findMany: jest.fn(({ where }: { where: { tiktokUrl: { in: string[] } } }) =>
        Promise.resolve(mappings.filter((row) => where.tiktokUrl.in.includes(row.tiktokUrl))),
      ),
      findFirst: jest.fn(
        ({ where }: { where: { OR: Array<{ sourceKey?: string; checksum?: string }> } }) =>
          Promise.resolve(mappings.find((row) =>
            where.OR.some(
              (clause) =>
                (clause.sourceKey && clause.sourceKey === row.sourceKey) ||
                (clause.checksum && clause.checksum === row.checksum),
            ),
          ) ?? null),
      ),
      upsert: jest.fn(({ create }: { create: Record<string, unknown> }) => {
        mappings.push(create as never);
        return Promise.resolve({ tiktokUrl: create.tiktokUrl, width: create.width, height: create.height });
      }),
    },
    storageFile: {
      findFirst: jest.fn(({ where }: { where: { publicUrl: string } }) =>
        Promise.resolve(storageFiles.find((file) => file.publicUrl === where.publicUrl) ?? null),
      ),
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
  const productApi = {
    uploadImage: jest.fn(async (_ctx: unknown, image: { fileName: string }, useCase: string) => {
      if (options.uploadImpl) return options.uploadImpl(image, useCase);
      counter += 1;
      return {
        data: {
          uri: `tos-uri-${counter}`,
          url: `https://p16-oec.tiktokcdn.com/desc/${counter}~tplv.jpeg`,
          width: 1600,
          height: 900,
          useCase,
        },
        requestId: `req-${counter}`,
      };
    }),
  };

  const service = new PodDescriptionImageService(prisma as never, storage as never, productApi as never);
  return { service, prisma, storage, productApi, mappings };
}

describe('PodDescriptionImageService.normalize', () => {
  it('Test 1 — mô tả chỉ chữ ⇒ không gọi gì, HTML nguyên vẹn', async () => {
    const { service, productApi } = buildService();
    const result = await service.normalize('org-1', CTX, '<p>Chỉ chữ</p>');
    expect(result.html).toBe('<p>Chỉ chữ</p>');
    expect(result.stats).toEqual({ total: 0, uploaded: 0, reused: 0, failed: 0, finalCount: 0 });
    expect(productApi.uploadImage).not.toHaveBeenCalled();
  });

  it('🔴 Test 2 — 1 ảnh Storage ⇒ upload với DESCRIPTION_IMAGE, src = url TikTok, có width/height, ghi mapping', async () => {
    const { service, productApi, prisma } = buildService({
      storageFiles: [{ id: 'file-a', publicUrl: `${CDN}/a.jpg`, checksum: 'sha-a' }],
    });

    const result = await service.normalize('org-1', CTX, `<p>x</p><img src="${CDN}/a.jpg" alt="a">`);

    expect(productApi.uploadImage).toHaveBeenCalledTimes(1);
    expect(productApi.uploadImage.mock.calls[0][2]).toBe('DESCRIPTION_IMAGE');
    expect(result.html).toBe(
      '<p>x</p><img src="https://p16-oec.tiktokcdn.com/desc/1~tplv.jpeg" alt="a" width="1600" height="900">',
    );
    expect(result.stats).toEqual({ total: 1, uploaded: 1, reused: 0, failed: 0, finalCount: 1 });
    const create = prisma.podTiktokDescriptionImage.upsert.mock.calls[0][0].create;
    expect(create).toMatchObject({
      organizationId: 'org-1',
      sourceKey: 'file:file-a',
      fileId: 'file-a',
      checksum: 'sha-a',
      tiktokUri: 'tos-uri-1',
      tiktokUrl: 'https://p16-oec.tiktokcdn.com/desc/1~tplv.jpeg',
      width: 1600,
      height: 900,
    });
  });

  it('Test 3 — 3 ảnh ⇒ 3 lần upload, 3 URL TikTok khác nhau; Test 4 — không còn URL CDN của ta', async () => {
    const { service, productApi } = buildService({
      storageFiles: [1, 2, 3].map((n) => ({ id: `f${n}`, publicUrl: `${CDN}/${n}.jpg`, checksum: `s${n}` })),
    });
    const html = [1, 2, 3].map((n) => `<img src="${CDN}/${n}.jpg">`).join('<br>');

    const result = await service.normalize('org-1', CTX, html);

    expect(productApi.uploadImage).toHaveBeenCalledTimes(3);
    expect(productApi.uploadImage.mock.calls.every((call) => call[2] === 'DESCRIPTION_IMAGE')).toBe(true);
    const srcs = extractDescriptionImages(result.html).map((ref) => ref.src);
    expect(new Set(srcs).size).toBe(3);
    expect(srcs.every((src) => src.startsWith('https://p16-oec.tiktokcdn.com/desc/'))).toBe(true);
    expect(result.html).not.toContain(CDN);
    expect(result.stats).toMatchObject({ total: 3, uploaded: 3, reused: 0, finalCount: 3 });
  });

  it('🔴 Test 5 — src đã là URL TikTok trong bảng mapping ⇒ KHÔNG upload lại, bổ sung width/height', async () => {
    const { service, productApi } = buildService({
      mappings: [{ sourceKey: 'file:old', tiktokUrl: 'https://tt/desc/old', width: 800, height: 600 }],
    });

    const result = await service.normalize('org-1', CTX, '<img src="https://tt/desc/old">');

    expect(productApi.uploadImage).not.toHaveBeenCalled();
    expect(result.html).toBe('<img src="https://tt/desc/old" width="800" height="600">');
    expect(result.stats).toMatchObject({ uploaded: 0, reused: 1 });
  });

  it('ảnh ĐANG có trên sản phẩm TikTok (Edit Product) ⇒ giữ nguyên thẻ, không upload', async () => {
    const { service, productApi } = buildService();
    const known = knownDescriptionImageUrls('<img src="https://tt/existing.jpg" width="1" height="1">');

    const result = await service.normalize('org-1', CTX, '<img src="https://tt/existing.jpg" width="1" height="1">', {
      knownTiktokUrls: known,
    });

    expect(productApi.uploadImage).not.toHaveBeenCalled();
    expect(result.html).toBe('<img src="https://tt/existing.jpg" width="1" height="1">');
  });

  it('dedup theo nguồn: cùng file Storage đã upload trước ⇒ dùng lại; cùng checksum khác tên ⇒ dùng lại', async () => {
    const { service, productApi } = buildService({
      storageFiles: [
        { id: 'f1', publicUrl: `${CDN}/f1.jpg`, checksum: 'same' },
        { id: 'f2', publicUrl: `${CDN}/f2-copy.jpg`, checksum: 'same' },
      ],
      mappings: [{ sourceKey: 'file:f1', checksum: 'same', tiktokUrl: 'https://tt/desc/f1', width: 10, height: 10 }],
    });

    const result = await service.normalize('org-1', CTX, `<img src="${CDN}/f1.jpg"><img src="${CDN}/f2-copy.jpg">`);

    expect(productApi.uploadImage).not.toHaveBeenCalled();
    expect(extractDescriptionImages(result.html).map((ref) => ref.src)).toEqual([
      'https://tt/desc/f1',
      'https://tt/desc/f1',
    ]);
    expect(result.stats).toMatchObject({ uploaded: 0, reused: 2 });
  });

  it('cùng một src xuất hiện 2 lần trong HTML ⇒ upload MỘT lần', async () => {
    const { service, productApi } = buildService({
      storageFiles: [{ id: 'f1', publicUrl: `${CDN}/f1.jpg`, checksum: null }],
    });
    const result = await service.normalize('org-1', CTX, `<img src="${CDN}/f1.jpg"><img src="${CDN}/f1.jpg">`);
    expect(productApi.uploadImage).toHaveBeenCalledTimes(1);
    expect(result.stats.finalCount).toBe(2);
  });

  it('URL ngoài (Description Template / CSV) không thuộc Storage ⇒ tải về rồi upload, khoá theo sha256(url)', async () => {
    const { service, productApi, prisma } = buildService();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    } as never);
    try {
      const result = await service.normalize('org-1', CTX, '<img src="https://cdn.printer.example/tpl/hero.png">');
      expect(productApi.uploadImage).toHaveBeenCalledTimes(1);
      expect(productApi.uploadImage.mock.calls[0][2]).toBe('DESCRIPTION_IMAGE');
      expect(prisma.podTiktokDescriptionImage.upsert.mock.calls[0][0].create.sourceKey).toMatch(/^url:[0-9a-f]{64}$/);
      expect(result.html).toContain('src="https://p16-oec.tiktokcdn.com/desc/1~tplv.jpeg"');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('🔴 Test 12 — upload hỏng ⇒ ném lỗi thân thiện, KHÔNG trả HTML để nơi gọi gửi đi', async () => {
    const { service } = buildService({
      storageFiles: [{ id: 'f1', publicUrl: `${CDN}/f1.jpg`, checksum: null }],
      uploadImpl: () => Promise.reject(new Error('network down')),
    });

    const failure = service.normalize('org-1', CTX, `<img src="${CDN}/f1.jpg">`);
    await expect(failure).rejects.toBeInstanceOf(PodDescriptionImageException);
    await expect(failure).rejects.toThrow(DESCRIPTION_IMAGE_UPLOAD_FAILED_MESSAGE);
  });

  it('data:/blob: ⇒ chặn ngay, không gọi TikTok', async () => {
    const { service, productApi } = buildService();
    await expect(
      service.normalize('org-1', CTX, '<img src="data:image/png;base64,AAAA">'),
    ).rejects.toBeInstanceOf(PodDescriptionImageException);
    expect(productApi.uploadImage).not.toHaveBeenCalled();
  });

  it('TikTok trả về thiếu url ⇒ coi là hỏng (không gửi một src rỗng)', async () => {
    const { service } = buildService({
      storageFiles: [{ id: 'f1', publicUrl: `${CDN}/f1.jpg`, checksum: null }],
      uploadImpl: () => Promise.resolve({ data: { uri: 'x' }, requestId: 'r' }),
    });
    await expect(service.normalize('org-1', CTX, `<img src="${CDN}/f1.jpg">`)).rejects.toBeInstanceOf(
      PodDescriptionImageException,
    );
  });
});
