import { PodTemplateService } from './pod-template.service';

/**
 * **Ảnh mặc định của giá trị biến thể** trong SKU Template — luật lưu:
 *
 *  - Chỉ trục ĐẦU TIÊN mang ảnh (`normalizeVariants` bỏ ảnh của trục sau).
 *  - Trục KHÔNG đổi mà chỉ đổi ảnh ⇒ cập nhật TẠI CHỖ (`syncValueImages`), không dời
 *    `axesUpdatedAt` (bảng SKU không bị coi là "cũ"), xoá cache `tiktokImageUri` của file cũ.
 *  - Trục đổi ⇒ ghi lại trục kèm ảnh (`writeAxes`).
 *  - File phải thuộc tổ chức (`assertFilesBelongToOrg`).
 */

type ValueRow = { value: string; imageFileId: string | null };
type ValueUpdate = { where: { id: string }; data: Record<string, unknown> };

const ORG = 'org-1';
const USER = 'user-1';

function buildService(existing: {
  variants: Array<{ name: string; values: Array<{ id: string; value: string; code: string | null; imageFileId: string | null }> }>;
}) {
  const tx = {
    podSkuTemplate: {
      update: jest.fn<Promise<unknown>, [{ where: unknown; data: Record<string, unknown> }]>().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'tpl-new' }),
    },
    podSkuTemplateVariant: {
      deleteMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'var-new' }),
    },
    podSkuTemplateVariantValue: {
      createMany: jest.fn<Promise<unknown>, [{ data: ValueRow[] }]>().mockResolvedValue({}),
      update: jest.fn<Promise<unknown>, [ValueUpdate]>().mockResolvedValue({}),
    },
  };
  const prisma = {
    // Mọi file đều "thuộc tổ chức" — đếm đúng bằng số id hỏi tới.
    storageFile: {
      count: jest.fn((args: { where: { id: { in: string[] } } }) => Promise.resolve(args.where.id.in.length)),
    },
    $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
  };
  const service = new PodTemplateService(prisma as never);
  const template = {
    id: 'tpl-1',
    name: 'Tee',
    skuPrefix: null,
    skuSuffix: null,
    defaultRetailPrice: null,
    defaultSalePrice: null,
    defaultQuantity: 0,
    defaultDiscount: null,
    currency: 'USD',
    isDefault: false,
    isActive: true,
    displayOrder: 0,
    note: null,
    axesUpdatedAt: new Date(),
    itemsGeneratedAt: null,
    items: [],
    ...existing,
  };
  // `getSkuTemplate` đọc DB thật — thay bằng bản giả để test tập trung vào luật ghi.
  Object.assign(service, { getSkuTemplate: jest.fn().mockResolvedValue(template) });
  return { service, tx, prisma };
}

const colorSize = (blackImage: string | null) => [
  {
    name: 'Color',
    values: [
      { value: 'Black', imageFileId: blackImage },
      { value: 'White', imageFileId: null },
    ],
  },
  { name: 'Size', values: [{ value: 'S', imageFileId: 'file-should-be-ignored' }] },
];

describe('PodTemplateService — ảnh giá trị biến thể', () => {
  it('createSkuTemplate ghi imageFileId cho trục ĐẦU, bỏ ảnh khai ở trục sau', async () => {
    const { service, tx, prisma } = buildService({ variants: [] });

    await service.createSkuTemplate(ORG, USER, { name: 'Tee', variants: colorSize('file-black') });

    const rows = tx.podSkuTemplateVariantValue.createMany.mock.calls.map(
      (call) => call[0].data,
    );
    expect(rows[0].map((row) => [row.value, row.imageFileId])).toEqual([
      ['Black', 'file-black'],
      ['White', null],
    ]);
    expect(rows[1].map((row) => [row.value, row.imageFileId])).toEqual([['S', null]]);
    expect(prisma.storageFile.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['file-black'] }, organizationId: ORG }) as unknown,
      }),
    );
  });

  it('🔴 trục không đổi, chỉ đổi ảnh ⇒ cập nhật tại chỗ, không xoá trục, không dời axesUpdatedAt, xoá cache uri', async () => {
    const { service, tx } = buildService({
      variants: [
        {
          name: 'Color',
          values: [
            { id: 'v-black', value: 'Black', code: 'BLACK', imageFileId: 'file-old' },
            { id: 'v-white', value: 'White', code: 'WHITE', imageFileId: null },
          ],
        },
        { name: 'Size', values: [{ id: 'v-s', value: 'S', code: 'S', imageFileId: null }] },
      ],
    });

    await service.updateSkuTemplate(ORG, USER, 'tpl-1', { name: 'Tee', variants: colorSize('file-new') });

    expect(tx.podSkuTemplateVariant.deleteMany).not.toHaveBeenCalled();
    expect(tx.podSkuTemplate.update.mock.calls[0][0].data).not.toHaveProperty('axesUpdatedAt');
    expect(tx.podSkuTemplateVariantValue.update).toHaveBeenCalledTimes(1);
    expect(tx.podSkuTemplateVariantValue.update).toHaveBeenCalledWith({
      where: { id: 'v-black' },
      data: { imageFileId: 'file-new', tiktokImageUri: null, imageUploadedAt: null },
    });
  });

  it('gỡ ảnh (null) ⇒ cập nhật về null; ảnh không đổi ⇒ không ghi gì', async () => {
    const { service, tx } = buildService({
      variants: [
        { name: 'Color', values: [{ id: 'v-black', value: 'Black', code: 'BLACK', imageFileId: 'file-old' }, { id: 'v-white', value: 'White', code: 'WHITE', imageFileId: 'file-white' }] },
        { name: 'Size', values: [{ id: 'v-s', value: 'S', code: 'S', imageFileId: null }] },
      ],
    });

    await service.updateSkuTemplate(ORG, USER, 'tpl-1', {
      name: 'Tee',
      variants: [
        { name: 'Color', values: [{ value: 'Black', imageFileId: null }, { value: 'White', imageFileId: 'file-white' }] },
        { name: 'Size', values: [{ value: 'S' }] },
      ],
    });

    expect(tx.podSkuTemplateVariantValue.update).toHaveBeenCalledTimes(1);
    expect(tx.podSkuTemplateVariantValue.update.mock.calls[0][0]).toEqual({
      where: { id: 'v-black' },
      data: { imageFileId: null, tiktokImageUri: null, imageUploadedAt: null },
    });
  });

  it('trục đổi (thêm giá trị) ⇒ ghi lại trục KÈM ảnh, có dời axesUpdatedAt', async () => {
    const { service, tx } = buildService({
      variants: [{ name: 'Color', values: [{ id: 'v-black', value: 'Black', code: 'BLACK', imageFileId: 'file-black' }] }],
    });

    await service.updateSkuTemplate(ORG, USER, 'tpl-1', {
      name: 'Tee',
      variants: [{ name: 'Color', values: [{ value: 'Black', imageFileId: 'file-black' }, { value: 'Navy', imageFileId: 'file-navy' }] }],
    });

    expect(tx.podSkuTemplateVariant.deleteMany).toHaveBeenCalled();
    expect(tx.podSkuTemplate.update.mock.calls[0][0].data).toHaveProperty('axesUpdatedAt');
    const rows = tx.podSkuTemplateVariantValue.createMany.mock.calls[0][0].data;
    expect(rows.map((row) => [row.value, row.imageFileId])).toEqual([['Black', 'file-black'], ['Navy', 'file-navy']]);
  });

  it('không có Color, chỉ có Size ⇒ vẫn lưu bình thường và Size (trục đầu) giữ ảnh của nó', async () => {
    const { service, tx } = buildService({ variants: [] });

    await service.createSkuTemplate(ORG, USER, {
      name: 'Poster',
      variants: [{ name: 'Size', values: [{ value: '8x12', imageFileId: 'file-8x12' }, { value: '12x18' }] }],
    });

    const rows = tx.podSkuTemplateVariantValue.createMany.mock.calls[0][0].data;
    expect(rows.map((row) => [row.value, row.imageFileId])).toEqual([['8x12', 'file-8x12'], ['12x18', null]]);
  });
});
