import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateGroupTemplateDto, UpdateGroupTemplateDto } from '../dto/pod-template.dto';
import { PodGroupTemplateService } from './pod-group-template.service';
import { PodTemplateService } from './pod-template.service';

/**
 * Group Template — CRUD + luật nghiệp vụ.
 *
 * Prisma giả: mọi luật (ít nhất một mảnh, tham chiếu cùng tổ chức, tên duy nhất, gộp
 * `undefined`/`null` khi sửa, xoá mềm) đều quyết định TRƯỚC khi ghi, nên kiểm được mà
 * không cần database. Index duy nhất từng phần + CHECK ở DB được kiểm ở test tích hợp.
 */

const ORG = 'org-1';
const USER = 'user-1';
const CAT = '11111111-1111-4111-8111-111111111111';
const SKU = '22222222-2222-4222-8222-222222222222';
const DESC = '33333333-3333-4333-8333-333333333333';
const IMG = '44444444-4444-4444-8444-444444444444';

function groupRow(over: Record<string, unknown> = {}) {
  return {
    id: 'group-1',
    organizationId: ORG,
    name: 'Tee US',
    categoryTemplateId: CAT,
    skuTemplateId: SKU,
    descriptionTemplateId: null,
    imageTemplateId: null,
    isActive: true,
    displayOrder: 0,
    note: null,
    updatedAt: new Date('2026-10-19T00:00:00Z'),
    categoryTemplate: { id: CAT, name: 'Cat', market: 'US' },
    _count: { listingSessions: 2 },
    ...over,
  };
}

function build(options: { refCount?: number; nameTaken?: number; group?: ReturnType<typeof groupRow> | null } = {}) {
  const count = jest.fn().mockResolvedValue(options.refCount ?? 1);
  const prisma = {
    podCategoryTemplate: { count },
    podSkuTemplate: { count },
    podDescriptionTemplate: { count },
    podImageTemplate: { count },
    podGroupTemplate: {
      count: jest.fn().mockResolvedValue(options.nameTaken ?? 0),
      create: jest.fn().mockResolvedValue({ id: 'group-1' }),
      update: jest.fn().mockResolvedValue({ id: 'group-1' }),
      findFirst: jest
        .fn()
        .mockResolvedValue(options.group === undefined ? groupRow() : options.group),
    },
  };
  const templates = {
    getCategoryTemplate: jest.fn().mockResolvedValue({ id: CAT, attributes: [] }),
    getSkuTemplate: jest.fn().mockResolvedValue({ id: SKU, items: [], effective: true }),
    getDescriptionTemplate: jest.fn().mockResolvedValue({ id: DESC, contentHtml: '<p>x</p>' }),
  };
  const images = { get: jest.fn().mockResolvedValue({ id: IMG, items: [] }) };
  const service = new PodGroupTemplateService(prisma as never, templates as never, images as never);
  return { service, prisma, templates, images, count };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const response = (error as { getResponse?: () => { code?: string } }).getResponse?.();
    return response?.code;
  }
}

describe('PodGroupTemplateService', () => {
  describe('list', () => {
    /** Prisma giả cho `list`: `$transaction([findMany, count])` trả đúng thứ hai truy vấn trả. */
    function buildList(items: unknown[] | Error, total = 0) {
      const findMany = jest.fn(() => (items instanceof Error ? Promise.reject(items) : Promise.resolve(items)));
      const count = jest.fn().mockResolvedValue(total);
      const prisma = {
        podGroupTemplate: { findMany, count },
        $transaction: (queries: Array<Promise<unknown>>) => Promise.all(queries),
      };
      const service = new PodGroupTemplateService(prisma as never, {} as never, {} as never);
      return { service, findMany, count };
    }

    it('tổ chức chưa có group ⇒ thành công với danh sách rỗng + meta chuẩn', async () => {
      const { service } = buildList([], 0);
      await expect(service.list(ORG, {})).resolves.toEqual({
        items: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      });
    });

    it('có group ⇒ trả đúng trang + meta, truy vấn luôn ràng buộc tổ chức + chưa xoá', async () => {
      const { service, findMany } = buildList([groupRow()], 45);
      const result = await service.list(ORG, { page: 2, limit: 20, search: 'tee', market: 'US' } as never);
      expect(result.meta).toEqual({ total: 45, page: 2, limit: 20, totalPages: 3 });
      expect(result.items).toHaveLength(1);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG,
            deletedAt: null,
            categoryTemplate: { market: 'US' },
            name: { contains: 'tee', mode: 'insensitive' },
          },
          skip: 20,
          take: 20,
        }),
      );
    });

    it('🔴 lỗi database thật (vd bảng chưa migrate, P2021) ⇒ NÉM lỗi, không biến thành danh sách rỗng', async () => {
      const missingTable = new Prisma.PrismaClientKnownRequestError(
        'The table `public.pod_group_templates` does not exist in the current database.',
        { code: 'P2021', clientVersion: 'test' },
      );
      const { service } = buildList(missingTable);
      await expect(service.list(ORG, {})).rejects.toBe(missingTable);
    });
  });

  describe('create', () => {
    it('lưu đúng tên + 4 tham chiếu, mảnh vắng = null, ghi người tạo', async () => {
      const { service, prisma } = build();
      await service.create(ORG, USER, {
        name: 'Tee US',
        categoryTemplateId: CAT,
        skuTemplateId: SKU,
        imageTemplateId: IMG,
      });
      expect(prisma.podGroupTemplate.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG,
          name: 'Tee US',
          categoryTemplateId: CAT,
          skuTemplateId: SKU,
          descriptionTemplateId: null,
          imageTemplateId: IMG,
          displayOrder: 0,
          note: null,
          createdBy: USER,
          updatedBy: USER,
        },
        select: { id: true },
      });
    });

    it('không mảnh nào ⇒ POD_GROUP_TEMPLATE_EMPTY, không ghi', async () => {
      const { service, prisma } = build();
      expect(await codeOf(service.create(ORG, USER, { name: 'Rỗng' }))).toBe('POD_GROUP_TEMPLATE_EMPTY');
      expect(prisma.podGroupTemplate.create).not.toHaveBeenCalled();
    });

    it('mảnh không thuộc tổ chức / đã xoá ⇒ POD_GROUP_TEMPLATE_INVALID_REF', async () => {
      const { service, prisma, count } = build({ refCount: 0 });
      expect(await codeOf(service.create(ORG, USER, { name: 'X', skuTemplateId: SKU }))).toBe(
        'POD_GROUP_TEMPLATE_INVALID_REF',
      );
      // Kiểm tham chiếu LUÔN ràng buộc tổ chức + chưa xoá.
      expect(count).toHaveBeenCalledWith({ where: { id: SKU, organizationId: ORG, deletedAt: null } });
      expect(prisma.podGroupTemplate.create).not.toHaveBeenCalled();
    });

    it('trùng tên (không phân biệt hoa thường) ⇒ 409 POD_GROUP_TEMPLATE_NAME_TAKEN', async () => {
      const { service, prisma } = build({ nameTaken: 1 });
      expect(await codeOf(service.create(ORG, USER, { name: 'tee us', skuTemplateId: SKU }))).toBe(
        'POD_GROUP_TEMPLATE_NAME_TAKEN',
      );
      expect(prisma.podGroupTemplate.count).toHaveBeenCalledWith({
        where: {
          organizationId: ORG,
          deletedAt: null,
          name: { equals: 'tee us', mode: 'insensitive' },
        },
      });
    });

    it('hai request song song cùng tên: index DB trả P2002 ⇒ vẫn là 409, không phải 500', async () => {
      const { service, prisma } = build();
      prisma.podGroupTemplate.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
      expect(await codeOf(service.create(ORG, USER, { name: 'Tee', skuTemplateId: SKU }))).toBe(
        'POD_GROUP_TEMPLATE_NAME_TAKEN',
      );
    });
  });

  describe('update', () => {
    it('mảnh không gửi = giữ nguyên, gửi null = gỡ, gửi id mới = thay', async () => {
      const { service, prisma } = build();
      await service.update(ORG, USER, 'group-1', {
        name: 'Tee US',
        skuTemplateId: null,
        descriptionTemplateId: DESC,
      });
      expect(prisma.podGroupTemplate.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: expect.objectContaining({
          categoryTemplateId: CAT,
          skuTemplateId: null,
          descriptionTemplateId: DESC,
          imageTemplateId: null,
          updatedBy: USER,
        }) as unknown,
      });
    });

    it('gỡ hết mảnh ⇒ POD_GROUP_TEMPLATE_EMPTY (kiểm trên KẾT QUẢ sau khi gộp)', async () => {
      const { service, prisma } = build();
      const code = await codeOf(
        service.update(ORG, USER, 'group-1', { name: 'Tee US', categoryTemplateId: null, skuTemplateId: null }),
      );
      expect(code).toBe('POD_GROUP_TEMPLATE_EMPTY');
      expect(prisma.podGroupTemplate.update).not.toHaveBeenCalled();
    });

    it('chỉ đổi hoa thường tên của chính nó ⇒ không coi là trùng', async () => {
      const { service, prisma } = build({ nameTaken: 1 });
      await service.update(ORG, USER, 'group-1', { name: 'TEE US' });
      expect(prisma.podGroupTemplate.count).not.toHaveBeenCalled();
      expect(prisma.podGroupTemplate.update).toHaveBeenCalled();
    });

    it('group của tổ chức khác / đã xoá ⇒ 404', async () => {
      const { service, prisma } = build({ group: null });
      expect(await codeOf(service.update(ORG, USER, 'group-x', { name: 'A', skuTemplateId: SKU }))).toBe(
        'POD_GROUP_TEMPLATE_NOT_FOUND',
      );
      expect(prisma.podGroupTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'group-x', organizationId: ORG, deletedAt: null } }),
      );
    });
  });

  describe('remove', () => {
    it('xoá MỀM và báo số lượt đăng đang ghi nhận group', async () => {
      const { service, prisma } = build();
      const result = await service.remove(ORG, USER, 'group-1');
      expect(result).toEqual({ id: 'group-1', referencedSessions: 2 });
      const call = prisma.podGroupTemplate.update.mock.calls[0] as [
        { where: unknown; data: { deletedAt: Date; isActive: boolean; updatedBy: string } },
      ];
      expect(call[0].where).toEqual({ id: 'group-1' });
      expect(call[0].data.deletedAt).toBeInstanceOf(Date);
      expect(call[0].data.isActive).toBe(false);
    });
  });

  describe('getResolved', () => {
    it('đọc bản đầy đủ CHỈ của những mảnh group có, qua đúng getter của từng loại', async () => {
      const { service, templates, images } = build();
      const resolved = await service.getResolved(ORG, 'group-1');
      expect(templates.getCategoryTemplate).toHaveBeenCalledWith(ORG, CAT);
      expect(templates.getSkuTemplate).toHaveBeenCalledWith(ORG, SKU);
      expect(templates.getDescriptionTemplate).not.toHaveBeenCalled();
      expect(images.get).not.toHaveBeenCalled();
      expect(resolved).toMatchObject({
        id: 'group-1',
        name: 'Tee US',
        market: 'US',
        categoryTemplate: { id: CAT },
        skuTemplate: { id: SKU, effective: true },
        descriptionTemplate: null,
        imageTemplate: null,
      });
    });
  });
});

describe('Group Template DTO', () => {
  const errorsOf = async (cls: typeof CreateGroupTemplateDto, body: Record<string, unknown>) =>
    (await validate(plainToInstance(cls, body))).map((error) => error.property);

  it('tên rỗng / chỉ khoảng trắng ⇒ lỗi `name`', async () => {
    expect(await errorsOf(CreateGroupTemplateDto, { name: '', skuTemplateId: SKU })).toContain('name');
    expect(await errorsOf(CreateGroupTemplateDto, { name: '   ', skuTemplateId: SKU })).toContain('name');
    expect(await errorsOf(CreateGroupTemplateDto, { skuTemplateId: SKU })).toContain('name');
  });

  it('tên quá 255 ký tự ⇒ lỗi', async () => {
    expect(await errorsOf(CreateGroupTemplateDto, { name: 'a'.repeat(256) })).toContain('name');
  });

  it('tham chiếu không phải UUID ⇒ lỗi; null hợp lệ (gỡ mảnh)', async () => {
    expect(await errorsOf(UpdateGroupTemplateDto, { name: 'A', categoryTemplateId: 'abc' })).toContain(
      'categoryTemplateId',
    );
    expect(await errorsOf(UpdateGroupTemplateDto, { name: 'A', categoryTemplateId: null })).toEqual([]);
  });
});

describe('Xoá template con đang nằm trong Group Template', () => {
  it('SKU Template đang được group dùng ⇒ POD_TEMPLATE_IN_USE, không xoá', async () => {
    const prisma = {
      podSkuTemplate: { update: jest.fn() },
      podListingTemplate: { count: jest.fn().mockResolvedValue(0) },
      podGroupTemplate: { count: jest.fn().mockResolvedValue(1) },
    };
    const service = new PodTemplateService(prisma as never);
    // Đọc template đã có test riêng — ở đây chỉ quan tâm cổng chặn xoá.
    jest.spyOn(service, 'getSkuTemplate').mockResolvedValue({ id: SKU } as never);
    expect(await codeOf(service.removeSkuTemplate(ORG, USER, SKU))).toBe('POD_TEMPLATE_IN_USE');
    expect(prisma.podGroupTemplate.count).toHaveBeenCalledWith({
      where: { skuTemplateId: SKU, organizationId: ORG, deletedAt: null },
    });
    expect(prisma.podSkuTemplate.update).not.toHaveBeenCalled();
  });
});
