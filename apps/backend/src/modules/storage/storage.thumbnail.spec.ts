import { StorageModuleName, StorageProviderName, StorageReferenceType } from '@prisma/client';
import sharp from 'sharp';
import { STORAGE_THUMBNAIL_MAX_SIZE, thumbnailObjectKey } from './storage-thumbnail.util';
import { StorageService, type UploadContext } from './storage.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const CTX: UploadContext = {
  organizationId: ORG,
  actorUserId: USER,
  module: StorageModuleName.POD_TIKTOK,
  referenceType: StorageReferenceType.FULFILLMENT_MAPPING_DESIGN,
  folderSegments: ['fulfillment', 'designs', ORG],
};

function makeFile(buffer: Buffer): Express.Multer.File {
  return { originalname: 'design.png', mimetype: 'image/png', size: buffer.length, buffer } as Express.Multer.File;
}

function build() {
  const provider = {
    name: StorageProviderName.LOCAL_DISK,
    put: jest.fn((params: { objectKey: string }) =>
      Promise.resolve({ objectKey: params.objectKey, publicUrl: `https://cdn/${params.objectKey}`, bucket: 'b' }),
    ),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const repo = {
    create: jest.fn((_tx: unknown, _org: string, _user: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: 'file-1', ...data }),
    ),
    softDelete: jest.fn().mockResolvedValue(undefined),
    setThumbnail: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = { $transaction: jest.fn((run: (client: unknown) => unknown) => run({})) };
  const config = { get: jest.fn((_key: string, fallback: unknown) => fallback) };
  const service = new StorageService(prisma as never, config as never, repo as never, provider as never);
  return { service, provider, repo };
}

const designPng = () =>
  sharp({ create: { width: 1200, height: 2000, channels: 4, background: { r: 200, g: 10, b: 10, alpha: 0.5 } } })
    .png()
    .toBuffer();

describe('StorageService — bản thu nhỏ', () => {
  it('🔴 withThumbnail: lưu file gốc NGUYÊN VẸN và kèm bản WEBP nhỏ giữ tỉ lệ, nền trong suốt', async () => {
    const { service, provider, repo } = build();
    const source = await designPng();
    await service.upload(makeFile(source), { ...CTX, withThumbnail: true });

    expect(provider.put).toHaveBeenCalledTimes(2);
    const [original, thumb] = provider.put.mock.calls.map(([params]) => params as unknown as { objectKey: string; body: Buffer; mimeType: string; cacheControl?: string });
    expect(original.body).toBe(source);
    expect(thumb.objectKey).toBe(thumbnailObjectKey(original.objectKey));
    expect(thumb.mimeType).toBe('image/webp');
    expect(thumb.cacheControl).toContain('immutable');
    const meta = await sharp(thumb.body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.height).toBe(STORAGE_THUMBNAIL_MAX_SIZE);
    expect(meta.width).toBe(Math.round((STORAGE_THUMBNAIL_MAX_SIZE * 1200) / 2000));
    expect(meta.hasAlpha).toBe(true);
    expect(repo.create.mock.calls[0][3]).toMatchObject({
      thumbnailObjectKey: thumb.objectKey,
      thumbnailUrl: `https://cdn/${thumb.objectKey}`,
    });
  });

  it('không bật ⇒ không tạo gì thêm (avatar, Excel, CCCD…)', async () => {
    const { service, provider, repo } = build();
    await service.upload(makeFile(await designPng()), CTX);
    expect(provider.put).toHaveBeenCalledTimes(1);
    expect(repo.create.mock.calls[0][3]).toMatchObject({ thumbnailObjectKey: null, thumbnailUrl: null });
  });

  it('🔴 không tạo được ⇒ upload VẪN thành công, cột để NULL', async () => {
    const { service, provider, repo } = build();
    await service.upload(makeFile(Buffer.from('khong-phai-anh-that')), { ...CTX, withThumbnail: true });
    expect(provider.put).toHaveBeenCalledTimes(1);
    expect(repo.create.mock.calls[0][3]).toMatchObject({ thumbnailObjectKey: null, thumbnailUrl: null });
  });

  it('ghi DB hỏng ⇒ dọn cả file gốc lẫn bản thu nhỏ', async () => {
    const { service, provider, repo } = build();
    repo.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.upload(makeFile(await designPng()), { ...CTX, withThumbnail: true })).rejects.toThrow('db down');
    expect(provider.delete).toHaveBeenCalledTimes(2);
  });

  it('xoá file ⇒ xoá luôn bản thu nhỏ; xoá bản thu nhỏ lỗi không chặn xoá file gốc', async () => {
    const { service, provider } = build();
    const remove = (service as unknown as { hardRemove: (file: object, actor: string) => Promise<void> }).hardRemove.bind(service);
    provider.delete.mockRejectedValueOnce(new Error('thumb gone'));
    await remove({ id: 'f', organizationId: ORG, objectKey: 'a.png', thumbnailObjectKey: 'a.png.thumb.webp' }, USER);
    expect(provider.delete.mock.calls.map(([key]) => key as unknown)).toEqual(['a.png.thumb.webp', 'a.png']);
  });

  it('attachThumbnail (dữ liệu cũ): ghi bản thu nhỏ, không ghi lại file gốc', async () => {
    const { service, provider, repo } = build();
    await expect(service.attachThumbnail({ id: 'f', objectKey: 'a.png' }, await designPng())).resolves.toBe(true);
    expect(provider.put).toHaveBeenCalledTimes(1);
    expect(repo.setThumbnail).toHaveBeenCalledWith('f', 'a.png.thumb.webp', 'https://cdn/a.png.thumb.webp');
  });

  it('attachThumbnail với dữ liệu không giải mã được ⇒ false, không ghi gì', async () => {
    const { service, repo } = build();
    await expect(service.attachThumbnail({ id: 'f', objectKey: 'a.png' }, Buffer.from('x'))).resolves.toBe(false);
    expect(repo.setThumbnail).not.toHaveBeenCalled();
  });
});
