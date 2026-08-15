import { StorageModuleName, StorageProviderName, StorageReferenceType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import {
  StorageExtensionBlockedException,
  StorageFileEmptyException,
  StorageFileInUseException,
  StorageFileMissingException,
  StorageFileNotFoundException,
  StorageFileTooLargeException,
  StorageMimeExtensionMismatchException,
  StorageProviderErrorKind,
  StorageProviderException,
  StorageProviderMisconfiguredException,
  StorageProviderTimeoutException,
  StorageUnsupportedTypeException,
} from './exceptions/storage.exceptions';
import { StorageRepository } from './storage.repository';
import { StorageService, UploadContext } from './storage.service';
import { callArg } from '../../testing/mock-call.util';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '33333333-3333-3333-3333-333333333333';
const FILE_ID = '44444444-4444-4444-4444-444444444444';
/** Giới hạn thật của production: 100MB. Test bám đúng con số đang chạy. */
const MAX_BYTES = 100 * 1024 * 1024;

function file(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'files',
    originalname: 'design.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 12,
    buffer: Buffer.from('binary-bytes'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
    ...overrides,
  };
}

function context(over: Partial<UploadContext> = {}): UploadContext {
  return {
    organizationId: ORG_ID,
    actorUserId: USER_ID,
    module: StorageModuleName.POD_TIKTOK,
    referenceType: StorageReferenceType.POD_ORDER_ITEM_DESIGN,
    referenceId: ITEM_ID,
    folderSegments: ['pod', 'designs', ORG_ID, ITEM_ID],
    ...over,
  };
}

describe('StorageService', () => {
  let service: StorageService;
  let prisma: { $transaction: jest.Mock };
  let repo: {
    create: jest.Mock;
    findById: jest.Mock;
    findByReference: jest.Mock;
    findMany: jest.Mock;
    softDelete: jest.Mock;
    countReferences: jest.Mock;
  };
  let provider: {
    name: StorageProviderName;
    put: jest.Mock;
    get: jest.Mock;
    delete: jest.Mock;
    exists: jest.Mock;
    resolvePublicUrl: jest.Mock;
  };

  beforeEach(() => {
    prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) };
    repo = {
      create: jest.fn((_tx, _org, _actor, data: Record<string, unknown>) =>
        Promise.resolve({ id: FILE_ID, organizationId: ORG_ID, ...data }),
      ),
      findById: jest.fn().mockResolvedValue({
        id: FILE_ID,
        organizationId: ORG_ID,
        objectKey: 'pod_tiktok/org/design.png',
        mimeType: 'image/png',
        fileSize: 12,
      }),
      findByReference: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      softDelete: jest.fn().mockResolvedValue(undefined),
      countReferences: jest.fn().mockResolvedValue(0),
    };
    provider = {
      name: StorageProviderName.CLOUDFLARE_R2,
      put: jest.fn((params: { objectKey: string }) =>
        Promise.resolve({
          objectKey: params.objectKey,
          publicUrl: `https://cdn.example.com/${params.objectKey}`,
          bucket: 'ncmedia',
        }),
      ),
      get: jest.fn().mockResolvedValue({ body: Buffer.from('x'), mimeType: 'image/png', size: 1 }),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      resolvePublicUrl: jest.fn(),
    };

    service = new StorageService(
      prisma as unknown as PrismaService,
      { get: () => MAX_BYTES } as unknown as ConfigService,
      repo as unknown as StorageRepository,
      provider,
    );
  });

  describe('upload — đặt tên & khoá đối tượng', () => {
    it('🔴 KHÔNG dùng tên file người dùng: tên lưu trữ là UUID + đuôi', async () => {
      await service.upload(file({ originalname: '../../etc/passwd.png' }), context());

      const put = callArg<{ objectKey: string }>(provider.put, 0, 0);
      const storedName = put.objectKey.split('/').pop() ?? '';
      expect(storedName).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/,
      );
      expect(put.objectKey).not.toContain('passwd');
    });

    it('🔴 khoá đối tượng không thể thoát khỏi thư mục gốc (path traversal)', async () => {
      await service.upload(file(), context({ folderSegments: ['pod', '..', '..', 'etc'] }));
      const put = callArg<{ objectKey: string }>(provider.put, 0, 0);
      expect(put.objectKey.startsWith('pod/etc/')).toBe(true);
      expect(put.objectKey).not.toContain('..');
    });

    it('lưu metadata kèm checksum, provider và bucket', async () => {
      const saved = await service.upload(file(), context());
      const data = callArg<{
        checksum: string;
        provider: StorageProviderName;
        bucket: string;
        fileSize: number;
        extension: string;
      }>(repo.create, 0, 3);

      expect(data.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(data.provider).toBe(StorageProviderName.CLOUDFLARE_R2);
      expect(data.bucket).toBe('ncmedia');
      expect(data.fileSize).toBe(12);
      expect(data.extension).toBe('png');
      expect(saved.id).toBe(FILE_ID);
    });

    it('🔴 ghi metadata lỗi → gỡ object vừa tạo, không để lại file mồ côi', async () => {
      prisma.$transaction.mockRejectedValue(new Error('DB down'));

      await expect(service.upload(file(), context())).rejects.toThrow('DB down');

      const putKey = callArg<{ objectKey: string }>(provider.put, 0, 0).objectKey;
      expect(provider.delete).toHaveBeenCalledWith(putKey);
    });
  });

  describe('upload — validate', () => {
    it('thiếu file → STORAGE_FILE_MISSING', async () => {
      await expect(service.upload(undefined, context())).rejects.toBeInstanceOf(
        StorageFileMissingException,
      );
      expect(provider.put).not.toHaveBeenCalled();
    });

    it('file rỗng 0 byte → STORAGE_FILE_EMPTY', async () => {
      await expect(
        service.upload(file({ buffer: Buffer.alloc(0) }), context()),
      ).rejects.toBeInstanceOf(StorageFileEmptyException);
      expect(provider.put).not.toHaveBeenCalled();
    });

    /**
     * Biên dung lượng quanh mốc 100MB.
     *
     * Dùng Buffer THẬT vì luồng upload còn tính checksum trên nội dung — buffer giả chỉ có
     * `length` sẽ hỏng ở bước băm chứ không phải ở bước kiểm dung lượng, tức test sẽ xanh/đỏ
     * vì lý do sai. `Buffer.alloc` cấp phát ngoài heap V8 và được giải phóng ngay sau mỗi case.
     */
    const sizedFile = (bytes: number) => file({ buffer: Buffer.alloc(bytes) });

    it.each([
      ['10 MB', 10 * 1024 * 1024],
      ['50 MB', 50 * 1024 * 1024],
      ['99 MB', 99 * 1024 * 1024],
    ])('cho phép upload file %s', async (_label, bytes) => {
      await expect(service.upload(sizedFile(bytes), context())).resolves.toBeDefined();
      expect(provider.put).toHaveBeenCalled();
    });

    it('cho phép upload file ĐÚNG bằng giới hạn (100MB)', async () => {
      // Ranh giới phải là "nhỏ hơn hoặc bằng": đúng 100MB là hợp lệ, không được chặn.
      await expect(service.upload(sizedFile(MAX_BYTES), context())).resolves.toBeDefined();
      expect(provider.put).toHaveBeenCalled();
    });

    it('chặn file lớn hơn giới hạn dù chỉ 1 byte', async () => {
      await expect(service.upload(sizedFile(MAX_BYTES + 1), context())).rejects.toBeInstanceOf(
        StorageFileTooLargeException,
      );
      expect(provider.put).not.toHaveBeenCalled();
    });

    it('thông báo lỗi nêu đúng giới hạn theo MB và tên file', async () => {
      try {
        await service.upload(sizedFile(MAX_BYTES + 1), context());
        fail('phải ném lỗi');
      } catch (error) {
        const body = (error as StorageFileTooLargeException).getResponse() as {
          code: string;
          message: string;
        };
        expect(body.code).toBe('STORAGE_FILE_TOO_LARGE');
        expect(body.message).toContain(String(Math.round(MAX_BYTES / (1024 * 1024))));
        expect(body.message).toContain('design.png');
      }
    });

    it('🔴 file thực thi (.exe) → bị chặn dù mime trông hợp lệ', async () => {
      await expect(
        service.upload(file({ originalname: 'payload.exe' }), context()),
      ).rejects.toBeInstanceOf(StorageExtensionBlockedException);
      expect(provider.put).not.toHaveBeenCalled();
    });

    it('🔴 script (.sh, .php, .js) → bị chặn', async () => {
      for (const name of ['run.sh', 'shell.php', 'evil.js']) {
        await expect(service.upload(file({ originalname: name }), context())).rejects.toBeInstanceOf(
          StorageExtensionBlockedException,
        );
      }
      expect(provider.put).not.toHaveBeenCalled();
    });

    it('đuôi ngoài danh sách cho phép (.txt) → STORAGE_UNSUPPORTED_TYPE', async () => {
      await expect(
        service.upload(file({ originalname: 'note.txt', mimetype: 'text/plain' }), context()),
      ).rejects.toBeInstanceOf(StorageUnsupportedTypeException);
    });

    it('không có phần mở rộng → STORAGE_UNSUPPORTED_TYPE', async () => {
      await expect(
        service.upload(file({ originalname: 'noextension' }), context()),
      ).rejects.toBeInstanceOf(StorageUnsupportedTypeException);
    });

    it('🔴 mime không khớp đuôi (đổi đuôi để lách) → bị từ chối', async () => {
      await expect(
        service.upload(
          file({ originalname: 'fake.png', mimetype: 'application/pdf' }),
          context(),
        ),
      ).rejects.toBeInstanceOf(StorageMimeExtensionMismatchException);
      expect(provider.put).not.toHaveBeenCalled();
    });

    it('chấp nhận đủ bộ định dạng nghiệp vụ: png, jpg, jpeg, webp, pdf, psd', async () => {
      const cases: Array<[string, string]> = [
        ['a.png', 'image/png'],
        ['a.jpg', 'image/jpeg'],
        ['a.jpeg', 'image/jpeg'],
        ['a.webp', 'image/webp'],
        ['a.pdf', 'application/pdf'],
        ['a.psd', 'image/vnd.adobe.photoshop'],
        ['a.psd', 'application/octet-stream'],
      ];
      for (const [originalname, mimetype] of cases) {
        await expect(
          service.upload(file({ originalname, mimetype }), context()),
        ).resolves.toBeDefined();
      }
      expect(provider.put).toHaveBeenCalledTimes(cases.length);
    });

    it('đuôi viết HOA vẫn hợp lệ và được chuẩn hoá về chữ thường', async () => {
      await service.upload(file({ originalname: 'DESIGN.PNG' }), context());
      expect(callArg<{ extension: string }>(repo.create, 0, 3).extension).toBe('png');
    });
  });

  describe('uploadMany', () => {
    it('không có file nào → STORAGE_FILE_MISSING', async () => {
      await expect(service.uploadMany([], context())).rejects.toBeInstanceOf(
        StorageFileMissingException,
      );
    });

    it('🔴 một file lỗi → gỡ các file đã tải lên trước đó', async () => {
      const result = service.uploadMany(
        [file({ originalname: 'ok.png' }), file({ originalname: 'bad.exe' })],
        context(),
      );

      await expect(result).rejects.toBeInstanceOf(StorageExtensionBlockedException);
      // File hợp lệ đầu tiên đã được ghi rồi ⇒ phải bị xoá mềm + gỡ khỏi kho lưu trữ.
      expect(repo.softDelete).toHaveBeenCalledTimes(1);
      expect(provider.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('🔴 file đang được nghiệp vụ tham chiếu → từ chối xoá', async () => {
      repo.countReferences.mockResolvedValue(1);

      await expect(service.remove(ORG_ID, USER_ID, FILE_ID)).rejects.toBeInstanceOf(
        StorageFileInUseException,
      );
      expect(provider.delete).not.toHaveBeenCalled();
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('không còn tham chiếu → xoá mềm metadata rồi xoá object', async () => {
      await service.remove(ORG_ID, USER_ID, FILE_ID);
      expect(repo.softDelete).toHaveBeenCalledTimes(1);
      expect(provider.delete).toHaveBeenCalledWith('pod_tiktok/org/design.png');
    });

    it('file không tồn tại → STORAGE_FILE_NOT_FOUND', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.remove(ORG_ID, USER_ID, FILE_ID)).rejects.toBeInstanceOf(
        StorageFileNotFoundException,
      );
    });

    it('removeInternal bỏ qua kiểm tra tham chiếu (module nghiệp vụ đã tự gỡ liên kết)', async () => {
      repo.countReferences.mockResolvedValue(5);
      await service.removeInternal(ORG_ID, USER_ID, FILE_ID);
      expect(provider.delete).toHaveBeenCalledTimes(1);
    });

    it('removeInternal với file không tồn tại → im lặng bỏ qua (idempotent)', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.removeInternal(ORG_ID, USER_ID, FILE_ID)).resolves.toBeUndefined();
      expect(provider.delete).not.toHaveBeenCalled();
    });
  });

  describe('dịch lỗi nhà cung cấp', () => {
    const providerError = (kind: StorageProviderErrorKind) =>
      new StorageProviderException(kind, 'get', 'boom', 'key');

    it('hết thời gian chờ → 504 STORAGE_PROVIDER_TIMEOUT', async () => {
      provider.get.mockRejectedValue(providerError(StorageProviderErrorKind.TIMEOUT));
      await expect(service.download(ORG_ID, FILE_ID)).rejects.toBeInstanceOf(
        StorageProviderTimeoutException,
      );
    });

    it('🔴 sai credential → lỗi cấu hình, KHÔNG lộ chi tiết hạ tầng', async () => {
      provider.get.mockRejectedValue(providerError(StorageProviderErrorKind.UNAUTHORIZED));
      await expect(service.download(ORG_ID, FILE_ID)).rejects.toBeInstanceOf(
        StorageProviderMisconfiguredException,
      );
    });

    it('bucket không tồn tại → lỗi cấu hình', async () => {
      provider.get.mockRejectedValue(providerError(StorageProviderErrorKind.BUCKET_NOT_FOUND));
      await expect(service.download(ORG_ID, FILE_ID)).rejects.toBeInstanceOf(
        StorageProviderMisconfiguredException,
      );
    });
  });

  describe('tenant isolation', () => {
    it('🔴 mọi truy vấn đều mang organizationId của người gọi', async () => {
      await service.findById(ORG_ID, FILE_ID);
      await service.findByReference(
        ORG_ID,
        StorageReferenceType.POD_ORDER_ITEM_DESIGN,
        ITEM_ID,
      );
      await service.findMany(ORG_ID, { page: 1, limit: 20 });

      expect(repo.findById).toHaveBeenCalledWith(ORG_ID, FILE_ID);
      expect(callArg<string>(repo.findByReference, 0, 0)).toBe(ORG_ID);
      expect(callArg<string>(repo.findMany, 0, 0)).toBe(ORG_ID);
    });
  });

  describe('defaultFolderSegments', () => {
    it('luôn tách dữ liệu theo module và tổ chức', () => {
      expect(
        service.defaultFolderSegments(
          ORG_ID,
          StorageModuleName.EMPLOYEE,
          StorageReferenceType.EMPLOYEE_AVATAR,
          ITEM_ID,
        ),
      ).toEqual(['employee', ORG_ID, 'employee_avatar', ITEM_ID]);
    });

    it('tôn trọng thư mục do người gọi chỉ định', () => {
      expect(
        service.defaultFolderSegments(
          ORG_ID,
          StorageModuleName.COMMON,
          StorageReferenceType.EXCEL_EXPORT,
          null,
          'exports/2026',
        ),
      ).toEqual(['common', ORG_ID, 'exports', '2026']);
    });
  });
});
