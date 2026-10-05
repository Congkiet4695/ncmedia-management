import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { PodDesignPlacement, StorageModuleName, StorageReferenceType } from '@prisma/client';
import { fetchRemoteFile, RemoteFetchError } from '../../../common/http/safe-remote-fetch';
import type { PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import { ProductDesignService } from './product-design.service';

type Row = Record<string, unknown>;
type WriteArgs = { data: Row };

jest.mock('../../../common/http/safe-remote-fetch', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '../../../common/http/safe-remote-fetch',
  );
  return { ...actual, fetchRemoteFile: jest.fn() };
});
const fetchMock = fetchRemoteFile as jest.MockedFunction<typeof fetchRemoteFile>;

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const KEY = { tiktokProductId: '1729000000000000001', sellerSku: 'POSTER-24X36' };
const ADMIN: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const R2_URL = 'https://pub-x.r2.dev/pod_tiktok/fulfillment/designs/a.png';

function remote(overrides: Partial<Awaited<ReturnType<typeof fetchRemoteFile>>> = {}) {
  return {
    buffer: PNG,
    contentType: 'image/png',
    fileName: 'front-art.png',
    finalUrl: 'https://drive.usercontent.google.com/download?id=x',
    redirects: 1,
    ...overrides,
  };
}

function build(
  options: { previous?: { id: string; storageFileId: string | null; version: number } } = {},
) {
  const designRow = (data: Record<string, unknown>) => ({
    id: 'design-1',
    placement: PodDesignPlacement.FRONT,
    version: 1,
    sourceUrl: null,
    storageFileId: 'file-new',
    ...data,
  });
  const tx = {
    fulfillmentProductDesign: {
      create: jest.fn<Promise<Row>, [WriteArgs]>(({ data }) => Promise.resolve(designRow(data))),
      update: jest.fn<Promise<Row>, [WriteArgs]>(({ data }) => Promise.resolve(designRow(data))),
    },
  };
  const prisma = {
    fulfillmentProductDesign: {
      findFirst: jest.fn().mockResolvedValue(options.previous ?? null),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown): unknown => fn(tx)) as jest.Mock,
  };
  const storage = {
    upload: jest
      .fn<Promise<Row>, [Express.Multer.File, Row]>()
      .mockResolvedValue({ id: 'file-new', publicUrl: R2_URL }),
    removeInternal: jest.fn().mockResolvedValue(undefined),
  };
  const mapper = {
    toDto: jest.fn((design: { storageFileId: string | null; sourceUrl: string | null }) => ({
      fileUrl: design.storageFileId ? R2_URL : design.sourceUrl,
      source: design.storageFileId ? 'UPLOAD' : 'URL',
    })),
  };
  const service = new ProductDesignService(
    prisma as never,
    storage as never,
    mapper as never,
    {} as never,
  );
  return { service, prisma, tx, storage, mapper };
}

const setUrl = (service: ProductDesignService, url: string) =>
  service.setUrl(ORG, USER, KEY, PodDesignPlacement.FRONT, url, ADMIN);

describe('ProductDesignService.setUrl — URL ⇒ tải về ⇒ lưu R2', () => {
  beforeEach(() => fetchMock.mockReset());

  it('URL ảnh công khai ⇒ tải về, lưu qua StorageService, design trỏ tới file trên kho (KHÔNG lưu URL gốc)', async () => {
    fetchMock.mockResolvedValue(remote());
    const { service, storage, tx } = build();

    const dto = await setUrl(service, 'https://cdn.example.com/art/front-art.png');

    expect(storage.upload).toHaveBeenCalledTimes(1);
    const [file, ctx] = storage.upload.mock.calls[0];
    expect(file).toMatchObject({
      mimetype: 'image/png',
      originalname: 'front-art.png',
      size: PNG.length,
    });
    expect(file.buffer).toBe(PNG);
    expect(ctx).toMatchObject({
      organizationId: ORG,
      module: StorageModuleName.POD_TIKTOK,
      referenceType: StorageReferenceType.FULFILLMENT_MAPPING_DESIGN,
      referenceId: null,
      folderSegments: ['fulfillment', 'designs', ORG, KEY.tiktokProductId, KEY.sellerSku],
    });
    const created = tx.fulfillmentProductDesign.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      storageFileId: 'file-new',
      placement: PodDesignPlacement.FRONT,
    });
    expect(created.sourceUrl).toBeUndefined();
    expect(dto).toEqual({ fileUrl: R2_URL, source: 'UPLOAD' });
  });

  it('🔴 link chia sẻ Google Drive ⇒ tải bằng link TẢI của cùng file (không lấy trang xem trước)', async () => {
    fetchMock.mockResolvedValue(remote());
    const { service } = build();

    await setUrl(
      service,
      'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing',
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUv',
    );
  });

  it('định dạng do CHỮ KÝ FILE quyết định: header octet-stream + bytes JPEG ⇒ lưu là JPEG, đuôi .jpg', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
    fetchMock.mockResolvedValue(
      remote({ buffer: jpeg, contentType: 'application/octet-stream', fileName: 'download.png' }),
    );
    const { service, storage } = build();

    await setUrl(service, 'https://cdn.example.com/download');

    expect(storage.upload.mock.calls[0][0]).toMatchObject({
      mimetype: 'image/jpeg',
      originalname: 'download.jpg',
    });
  });

  it.each([
    [
      'HTML (Drive chưa chia sẻ / trang đăng nhập)',
      remote({ contentType: 'text/html', buffer: Buffer.from('<html>') }),
      'NOT_IMAGE',
    ],
    [
      'header nói là ảnh nhưng bytes là HTML',
      remote({ contentType: 'image/png', buffer: Buffer.from('<!DOCTYPE html>') }),
      'UNSUPPORTED_TYPE',
    ],
    [
      'GIF (định dạng không hỗ trợ)',
      remote({ contentType: 'image/gif', buffer: Buffer.from('GIF89a........') }),
      'UNSUPPORTED_TYPE',
    ],
    ['JSON', remote({ contentType: 'application/json', buffer: PNG }), 'UNSUPPORTED_TYPE'],
  ])('🔴 %s ⇒ 422, KHÔNG lưu gì', async (_label, response, reason) => {
    fetchMock.mockResolvedValue(response);
    const { service, storage, tx } = build();

    const error = await setUrl(service, 'https://cdn.example.com/a.png').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'FULFILLMENT_DESIGN_URL_FETCH_FAILED',
      details: { reason },
    });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(tx.fulfillmentProductDesign.create).not.toHaveBeenCalled();
  });

  it.each([
    ['TOO_LARGE', new RemoteFetchError('TOO_LARGE', 'File vượt giới hạn 25 MB.')],
    ['TIMEOUT', new RemoteFetchError('TIMEOUT', 'Hết thời gian chờ tải file.')],
    [
      'HTTP_STATUS (link hết hạn)',
      new RemoteFetchError('HTTP_STATUS', 'Máy chủ trả về HTTP 404.', 404),
    ],
    ['TOO_MANY_REDIRECTS', new RemoteFetchError('TOO_MANY_REDIRECTS', 'Quá 5 lần chuyển hướng.')],
  ])(
    '🔴 tải lỗi %s ⇒ 422 FULFILLMENT_DESIGN_URL_FETCH_FAILED, design cũ giữ nguyên',
    async (_label, failure) => {
      fetchMock.mockRejectedValue(failure);
      const { service, storage, tx } = build({
        previous: { id: 'design-1', storageFileId: 'file-old', version: 3 },
      });

      const error = await setUrl(service, 'https://cdn.example.com/a.png').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'FULFILLMENT_DESIGN_URL_FETCH_FAILED',
        details: { reason: failure.reason },
      });
      expect(storage.upload).not.toHaveBeenCalled();
      expect(storage.removeInternal).not.toHaveBeenCalled();
      expect(tx.fulfillmentProductDesign.update).not.toHaveBeenCalled();
    },
  );

  it('🔴 SSRF: chuyển hướng / phân giải về địa chỉ nội bộ ⇒ 400 FULFILLMENT_DESIGN_URL_INVALID', async () => {
    fetchMock.mockRejectedValue(
      new RemoteFetchError('NOT_PUBLIC', 'URL trỏ vào địa chỉ nội bộ — không được phép.'),
    );
    const { service, storage } = build();

    const error = await setUrl(service, 'https://redirector.example.com/x').catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'FULFILLMENT_DESIGN_URL_INVALID',
      details: { reason: 'NOT_PUBLIC' },
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it.each([
    'http://127.0.0.1/a.png',
    'https://localhost/a.png',
    'http://169.254.169.254/latest',
    'ftp://cdn.example.com/a.png',
  ])('🔴 %s ⇒ 400 ngay khi nhập, KHÔNG gửi request nào', async (url) => {
    const { service } = build();
    await expect(setUrl(service, url)).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('http:// công khai ⇒ nhận (server tự tải; nhà cung cấp chỉ thấy URL trên kho)', async () => {
    fetchMock.mockResolvedValue(remote());
    const { service, storage } = build();
    await setUrl(service, 'http://cdn.example.com/a.png');
    expect(storage.upload).toHaveBeenCalled();
  });

  it('🔴 đẩy lên kho (R2) thất bại ⇒ lỗi trả ra, KHÔNG ghi design, design cũ giữ nguyên', async () => {
    fetchMock.mockResolvedValue(remote());
    const { service, storage, tx } = build({
      previous: { id: 'design-1', storageFileId: 'file-old', version: 2 },
    });
    storage.upload.mockRejectedValue(new Error('R2 upload failed'));

    await expect(setUrl(service, 'https://cdn.example.com/a.png')).rejects.toThrow(
      'R2 upload failed',
    );
    expect(tx.fulfillmentProductDesign.update).not.toHaveBeenCalled();
    expect(storage.removeInternal).not.toHaveBeenCalled();
  });

  it('thay design cũ (file hoặc URL ngoài) ⇒ tăng version, bỏ source_url, xoá file cũ SAU khi ghi DB', async () => {
    fetchMock.mockResolvedValue(remote());
    const { service, storage, tx } = build({
      previous: { id: 'design-1', storageFileId: 'file-old', version: 2 },
    });

    await setUrl(service, 'https://cdn.example.com/a.png');

    expect(tx.fulfillmentProductDesign.update.mock.calls[0][0].data).toMatchObject({
      storageFileId: 'file-new',
      sourceUrl: null,
      version: 3,
    });
    expect(storage.removeInternal).toHaveBeenCalledWith(ORG, USER, 'file-old');
  });

  it('🔴 ghi DB hỏng ⇒ dọn file vừa đẩy lên kho', async () => {
    fetchMock.mockResolvedValue(remote());
    const { service, storage, prisma } = build();
    prisma.$transaction.mockRejectedValue(new Error('db down'));

    await expect(setUrl(service, 'https://cdn.example.com/a.png')).rejects.toThrow('db down');
    expect(storage.removeInternal).toHaveBeenCalledWith(ORG, USER, 'file-new');
  });
});
