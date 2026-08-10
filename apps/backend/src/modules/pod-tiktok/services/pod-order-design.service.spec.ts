import { BadRequestException } from '@nestjs/common';
import { PodDesignPlacement } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { StorageMapper } from '../../storage/storage.mapper';
import { StorageService } from '../../storage/storage.service';
import {
  PodDesignNotFoundException,
  PodOrderItemNotFoundException,
} from '../exceptions/pod-tiktok.exceptions';
import { PodOrderDesignRepository } from '../repositories/pod-order-design.repository';
import { PodOrderDesignService } from './pod-order-design.service';
import { callArg } from '../../../testing/mock-call.util';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '33333333-3333-3333-3333-333333333333';
const ORDER_ID = '44444444-4444-4444-4444-444444444444';
const NEW_FILE_ID = '55555555-5555-5555-5555-555555555555';
const OLD_FILE_ID = '66666666-6666-6666-6666-666666666666';

function pngFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'front.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 2048,
    buffer: Buffer.from('fake-png-bytes'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
    ...overrides,
  };
}

/** Bản ghi file trong Storage Module (metadata nằm ở `storage_files`). */
function storageFileRow(over: Record<string, unknown> = {}) {
  return {
    id: NEW_FILE_ID,
    originalName: 'front.png',
    mimeType: 'image/png',
    fileSize: 2048,
    publicUrl: 'http://localhost:3000/uploads/pod/designs/org/item/new.png',
    uploadedAt: new Date('2026-08-06T10:00:00Z'),
    uploader: { id: USER_ID, fullName: 'Nguyễn Văn A' },
    ...over,
  };
}

function designRow(over: Record<string, unknown> = {}) {
  return {
    id: 'design-uuid',
    placement: PodDesignPlacement.FRONT,
    storageFileId: NEW_FILE_ID,
    version: 1,
    storageFile: storageFileRow(),
    ...over,
  };
}

describe('PodOrderDesignService', () => {
  let service: PodOrderDesignService;
  let prisma: { $transaction: jest.Mock };
  let repo: {
    findItemInOrg: jest.Mock;
    findByPlacement: jest.Mock;
    findByItem: jest.Mock;
    upsert: jest.Mock;
    softDelete: jest.Mock;
  };
  let storage: { upload: jest.Mock; removeInternal: jest.Mock };

  beforeEach(() => {
    prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) };
    repo = {
      findItemInOrg: jest.fn().mockResolvedValue({
        id: ITEM_ID,
        organizationId: ORG_ID,
        orderId: ORDER_ID,
        productName: 'T-Shirt',
        skuName: 'Black / L',
        sellerSku: 'TS-BLK-L',
        productId: 'p-1',
      }),
      findByPlacement: jest.fn().mockResolvedValue(null),
      findByItem: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(designRow()),
      softDelete: jest.fn().mockResolvedValue(OLD_FILE_ID),
    };
    storage = {
      upload: jest.fn().mockResolvedValue(storageFileRow()),
      removeInternal: jest.fn().mockResolvedValue(undefined),
    };

    service = new PodOrderDesignService(
      prisma as unknown as PrismaService,
      repo as unknown as PodOrderDesignRepository,
      storage as unknown as StorageService,
      new StorageMapper({ get: () => 'api/v1' } as never),
    );
  });

  describe('upload', () => {
    it('đẩy file qua StorageService rồi ghi DB, trả về bản ghi để FE preview', async () => {
      const result = await service.upload(
        ORG_ID,
        USER_ID,
        ITEM_ID,
        PodDesignPlacement.FRONT,
        pngFile(),
      );

      expect(storage.upload).toHaveBeenCalledTimes(1);
      expect(repo.upsert).toHaveBeenCalledTimes(1);
      expect(result.fileUrl).toContain('/uploads/');
      expect(result.placement).toBe(PodDesignPlacement.FRONT);
      expect(result.uploadedByName).toBe('Nguyễn Văn A');
    });

    it('🔴 KHÔNG tự ghi file — mọi thao tác lưu trữ đi qua StorageService', async () => {
      await service.upload(ORG_ID, USER_ID, ITEM_ID, PodDesignPlacement.FRONT, pngFile());
      const ctx = callArg<{
        module: string;
        referenceType: string;
        referenceId: string;
        folderSegments: string[];
      }>(storage.upload, 0, 1);

      expect(ctx.module).toBe('POD_TIKTOK');
      expect(ctx.referenceType).toBe('POD_ORDER_ITEM_DESIGN');
      expect(ctx.referenceId).toBe(ITEM_ID);
      expect(ctx.folderSegments).toEqual(['pod', 'designs', ORG_ID, ITEM_ID]);
    });

    it('ghi đúng vị trí in được yêu cầu (BACK không đụng FRONT)', async () => {
      await service.upload(ORG_ID, USER_ID, ITEM_ID, PodDesignPlacement.BACK, pngFile());
      const params = callArg<{ placement: PodDesignPlacement; orderItemId: string }>(
        repo.upsert,
        0,
        1,
      );
      expect(params.placement).toBe(PodDesignPlacement.BACK);
      expect(params.orderItemId).toBe(ITEM_ID);
    });

    it('🔴 THAY design: xoá file cũ khỏi kho lưu trữ sau khi ghi DB thành công', async () => {
      repo.findByPlacement.mockResolvedValue({ storageFileId: OLD_FILE_ID });
      repo.upsert.mockResolvedValue(designRow({ version: 2 }));

      const result = await service.upload(
        ORG_ID,
        USER_ID,
        ITEM_ID,
        PodDesignPlacement.FRONT,
        pngFile(),
      );

      expect(storage.removeInternal).toHaveBeenCalledWith(ORG_ID, USER_ID, OLD_FILE_ID);
      expect(result.version).toBe(2);
    });

    it('upload lần đầu KHÔNG xoá gì cả', async () => {
      await service.upload(ORG_ID, USER_ID, ITEM_ID, PodDesignPlacement.FRONT, pngFile());
      expect(storage.removeInternal).not.toHaveBeenCalled();
    });

    it('🔴 ghi DB lỗi → dọn file vừa lưu, không để lại file rác', async () => {
      prisma.$transaction.mockRejectedValue(new Error('DB down'));

      await expect(
        service.upload(ORG_ID, USER_ID, ITEM_ID, PodDesignPlacement.FRONT, pngFile()),
      ).rejects.toThrow('DB down');

      expect(storage.removeInternal).toHaveBeenCalledWith(ORG_ID, USER_ID, NEW_FILE_ID);
    });

    it('thiếu file → BadRequest, KHÔNG chạm kho lưu trữ', async () => {
      await expect(
        service.upload(ORG_ID, USER_ID, ITEM_ID, PodDesignPlacement.FRONT, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('sai định dạng (PDF) → BadRequest (design chỉ nhận ảnh)', async () => {
      await expect(
        service.upload(
          ORG_ID,
          USER_ID,
          ITEM_ID,
          PodDesignPlacement.FRONT,
          pngFile({ mimetype: 'application/pdf' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('chấp nhận JPEG và WEBP', async () => {
      await expect(
        service.upload(
          ORG_ID,
          USER_ID,
          ITEM_ID,
          PodDesignPlacement.FRONT,
          pngFile({ mimetype: 'image/jpeg', originalname: 'a.jpg' }),
        ),
      ).resolves.toBeDefined();
      await expect(
        service.upload(
          ORG_ID,
          USER_ID,
          ITEM_ID,
          PodDesignPlacement.BACK,
          pngFile({ mimetype: 'image/webp', originalname: 'b.webp' }),
        ),
      ).resolves.toBeDefined();
    });

    it('🔴 sản phẩm thuộc tổ chức khác → không tìm thấy, KHÔNG lưu file', async () => {
      repo.findItemInOrg.mockResolvedValue(null);

      await expect(
        service.upload(OTHER_ORG_ID, USER_ID, ITEM_ID, PodDesignPlacement.FRONT, pngFile()),
      ).rejects.toBeInstanceOf(PodOrderItemNotFoundException);
      expect(storage.upload).not.toHaveBeenCalled();
    });
  });

  describe('findByItem', () => {
    it('trả về design của sản phẩm', async () => {
      repo.findByItem.mockResolvedValue([designRow(), designRow({ placement: 'BACK' })]);
      const result = await service.findByItem(ORG_ID, ITEM_ID);
      expect(result).toHaveLength(2);
      expect(result.map((d) => d.placement)).toEqual(['FRONT', 'BACK']);
    });

    it('bucket private (không có publicUrl) → dùng đường tải qua API', async () => {
      repo.findByItem.mockResolvedValue([
        designRow({ storageFile: storageFileRow({ publicUrl: null }) }),
      ]);
      const result = await service.findByItem(ORG_ID, ITEM_ID);
      expect(result[0].fileUrl).toBe(`/api/v1/storage/${NEW_FILE_ID}/download`);
    });

    it('sản phẩm không thuộc tổ chức → không tìm thấy', async () => {
      repo.findItemInOrg.mockResolvedValue(null);
      await expect(service.findByItem(OTHER_ORG_ID, ITEM_ID)).rejects.toBeInstanceOf(
        PodOrderItemNotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('gỡ liên kết trước rồi mới xoá file trên kho lưu trữ', async () => {
      await service.remove(ORG_ID, USER_ID, ITEM_ID, PodDesignPlacement.FRONT);

      expect(repo.softDelete).toHaveBeenCalledWith(
        expect.anything(),
        ORG_ID,
        ITEM_ID,
        PodDesignPlacement.FRONT,
        USER_ID,
      );
      expect(storage.removeInternal).toHaveBeenCalledWith(ORG_ID, USER_ID, OLD_FILE_ID);
    });

    it('chưa có design ở vị trí đó → báo không tìm thấy', async () => {
      repo.softDelete.mockResolvedValue(null);
      await expect(
        service.remove(ORG_ID, USER_ID, ITEM_ID, PodDesignPlacement.BACK),
      ).rejects.toBeInstanceOf(PodDesignNotFoundException);
      expect(storage.removeInternal).not.toHaveBeenCalled();
    });
  });
});
