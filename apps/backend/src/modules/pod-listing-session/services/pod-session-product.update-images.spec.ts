import { BadRequestException } from '@nestjs/common';
import { PodListingSessionProductStatus, PodListingSessionStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { PrismaService } from '../../../database/prisma.service';
import type { PodListingResolverService } from '../../pod-listing/services/pod-listing-resolver.service';
import type { PodListingTemplateService } from '../../pod-listing/services/pod-listing-template.service';
import type { PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import { callArg } from '../../../testing/mock-call.util';
import { UpdateSessionProductDto } from '../dto/pod-listing-session.dto';
import type { PodListingSessionService } from './pod-listing-session.service';
import { isPersistentImageUrl, PodSessionProductService } from './pod-session-product.service';

/**
 * Edit Draft Product — lưu ảnh: thứ tự, giới hạn số ảnh, ảnh dán/tải lên (fileId) phải thuộc tổ chức.
 */
const ORG = 'org-a';
const SCOPE: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };
const FILE_A = '11111111-1111-4111-8111-111111111111';
const FILE_B = '22222222-2222-4222-8222-222222222222';

describe('PodSessionProductService.update — ảnh', () => {
  let service: PodSessionProductService;
  let tx: {
    podListingSessionProduct: { update: jest.Mock };
    podListingSessionProductImage: { deleteMany: jest.Mock; createMany: jest.Mock };
    podListingSession: { updateMany: jest.Mock };
  };
  let prisma: {
    storageFile: { count: jest.Mock };
    podListingSessionProduct: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let sessions: { get: jest.Mock };

  beforeEach(() => {
    tx = {
      podListingSessionProduct: { update: jest.fn() },
      podListingSessionProductImage: { deleteMany: jest.fn(), createMany: jest.fn() },
      podListingSession: { updateMany: jest.fn() },
    };
    prisma = {
      storageFile: { count: jest.fn() },
      podListingSessionProduct: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'p1',
          status: PodListingSessionProductStatus.DRAFT,
          images: [],
        }),
      },
      $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    sessions = {
      get: jest.fn().mockResolvedValue({ id: 's1', status: PodListingSessionStatus.DRAFT }),
    };
    service = new PodSessionProductService(
      prisma as unknown as PrismaService,
      sessions as unknown as PodListingSessionService,
      {} as PodListingResolverService,
      {} as PodListingTemplateService,
    );
  });

  it('🔴 lưu ĐÚNG thứ tự gửi lên (ảnh đầu = thumbnail), giữ fileId của ảnh đã tải lên', async () => {
    prisma.storageFile.count.mockResolvedValue(1);

    await service.update(
      ORG,
      'u1',
      's1',
      'p1',
      {
        title: 'Tee',
        images: [
          { imageUrl: 'https://cdn.r2.dev/pasted.png', fileId: FILE_A, sortOrder: 0 },
          { imageUrl: 'https://cdn.example/a.jpg', sortOrder: 1 },
          { imageUrl: 'https://cdn.example/b.jpg', sortOrder: 2 },
        ],
      },
      SCOPE,
    );

    const rows = callArg<{ data: Array<Record<string, unknown>> }>(
      tx.podListingSessionProductImage.createMany,
      0,
      0,
    ).data;
    expect(rows.map((row) => [row.imageUrl, row.sortOrder, row.fileId])).toEqual([
      ['https://cdn.r2.dev/pasted.png', 0, FILE_A],
      ['https://cdn.example/a.jpg', 1, null],
      ['https://cdn.example/b.jpg', 2, null],
    ]);
    expect(rows.every((row) => row.organizationId === ORG)).toBe(true);
    expect(prisma.storageFile.count).toHaveBeenCalledWith({
      where: { id: { in: [FILE_A] }, organizationId: ORG, deletedAt: null },
    });
  });

  it('🔴 fileId của tổ chức khác / không tồn tại ⇒ 400, KHÔNG ghi gì', async () => {
    prisma.storageFile.count.mockResolvedValue(1); // chỉ 1 trong 2 file thuộc tổ chức

    await expect(
      service.update(
        ORG,
        'u1',
        's1',
        'p1',
        {
          images: [
            { imageUrl: 'https://cdn/x.png', fileId: FILE_A },
            { imageUrl: 'https://cdn/y.png', fileId: FILE_B },
          ],
        },
        SCOPE,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    'blob:https://app/123',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    '//evil.example/a.png',
  ])('🔴 URL không lưu lâu dài được (%s) ⇒ 400, KHÔNG ghi gì', async (imageUrl) => {
    await expect(
      service.update(ORG, 'u1', 's1', 'p1', { images: [{ imageUrl }] }, SCOPE),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('chỉ sửa tiêu đề (không gửi images) ⇒ không đụng tới ảnh, không kiểm Storage', async () => {
    await service.update(ORG, 'u1', 's1', 'p1', { title: 'Only title' }, SCOPE);

    expect(tx.podListingSessionProductImage.deleteMany).not.toHaveBeenCalled();
    expect(prisma.storageFile.count).not.toHaveBeenCalled();
  });

  it('🔴 Draft Product của lượt đăng khác / tổ chức khác ⇒ không tìm thấy, không ghi', async () => {
    prisma.podListingSessionProduct.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.update(
        ORG,
        'u1',
        's1',
        'p-other',
        { images: [{ imageUrl: 'https://cdn/x.png' }] },
        SCOPE,
      ),
    ).rejects.toThrow();
    const lookup = callArg<{ where: Record<string, unknown> }>(
      prisma.podListingSessionProduct.findFirst,
      0,
      0,
    );
    expect(lookup.where).toEqual(expect.objectContaining({ organizationId: ORG, sessionId: 's1' }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('isPersistentImageUrl', () => {
  it.each([
    ['https://cdn.example/a.jpg', true],
    ['HTTP://cdn.example/a.jpg', true],
    ['/uploads/pod/a.png', true],
    ['blob:https://app/1', false],
    ['data:image/png;base64,AA', false],
    ['//cdn.example/a.png', false],
    ['ftp://cdn/a.png', false],
    ['', false],
  ])('%s ⇒ %s', (url, expected) => {
    expect(isPersistentImageUrl(url)).toBe(expected);
  });
});

describe('UpdateSessionProductDto — trần số ảnh', () => {
  it('🔴 quá 10 ảnh ⇒ lỗi validate; đúng 10 ⇒ hợp lệ', async () => {
    const images = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ imageUrl: `https://cdn/${i}.png`, sortOrder: i }));
    expect(
      await validate(plainToInstance(UpdateSessionProductDto, { images: images(11) })),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(UpdateSessionProductDto, { images: images(10) })),
    ).toHaveLength(0);
  });
});
