import { PodImageAssetType } from '@prisma/client';
import { parseCsv, toCsv } from '../../../common/csv/csv.util';
import { POD_TEMPLATE_CSV_COLUMNS } from '../constants/pod-template-csv.constants';
import { PodTemplateTransferService } from './pod-template-transfer.service';

/**
 * Template — Export / Import THEO DÒNG bằng CSV (Category · SKU · Description · Image).
 *
 * Prisma giả đủ để kiểm luật của service (chỉ id đã chọn, thuộc tổ chức, không xoá gì ngoài file, lỗi theo
 * dòng). Luồng xuyên tổ chức trên Postgres THẬT: `test/manual/e2e-template-csv-transfer.manual.ts`.
 */

const ORG = 'org-a';
const COPIED_0 = '00000000-0000-4000-8000-000000000000';
const USER = 'user-a';

function build() {
  const files = new Map<string, { id: string; organizationId: string; publicUrl: string | null; objectKey: string; mimeType: string; fileSize: number }>();
  const prisma = {
    podCategoryTemplate: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    podSkuTemplate: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), delete: jest.fn() },
    podDescriptionTemplate: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    podImageTemplate: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), delete: jest.fn() },
    podTiktokWarehouse: { findFirst: jest.fn().mockResolvedValue(null) },
    storageFile: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] }; organizationId: string } }) =>
        Promise.resolve([...files.values()].filter((f) => where.id.in.includes(f.id) && f.organizationId === where.organizationId)),
      ),
      findFirst: jest.fn(({ where }: { where: { id: string; organizationId: string } }) =>
        Promise.resolve([...files.values()].find((f) => f.id === where.id && f.organizationId === where.organizationId) ?? null),
      ),
      findFirstOrThrow: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(files.get(where.id))),
    },
    podSkuTemplateItem: { update: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const templates = {
    createCategoryTemplate: jest.fn().mockResolvedValue({ id: 'new-cat' }),
    createSkuTemplate: jest.fn().mockResolvedValue({ id: 'new-sku' }),
    generateSkuItems: jest.fn().mockResolvedValue({ id: 'new-sku', items: [{ id: 'item-1', variantName: 'Black / S' }] }),
    createDescriptionTemplate: jest.fn().mockResolvedValue({ id: 'new-desc' }),
  };
  const images = {
    create: jest.fn().mockResolvedValue({ id: 'new-img' }),
    restoreItems: jest.fn().mockResolvedValue({ created: 1, skipped: 0 }),
  };
  const imageUrls = {
    // "Chép" ảnh: tạo file mới thuộc tổ chức đích.
    importImage: jest.fn((organizationId: string, _user: string, url: string) => {
      if (url.includes('broken')) return Promise.reject(new Error('máy chủ trả về 404'));
      const id = `00000000-0000-4000-8000-${String(files.size).padStart(12, "0")}`;
      files.set(id, { id, organizationId, publicUrl: `https://cdn.test/${id}.png`, objectKey: `k/${id}.png`, mimeType: 'image/png', fileSize: 10 });
      return Promise.resolve({ id });
    }),
  };
  const service = new PodTemplateTransferService(
    prisma as never,
    templates as never,
    images as never,
    {} as never,
    imageUrls as never,
  );
  return { service, prisma, templates, images, imageUrls, files };
}

const header = (kind: keyof typeof POD_TEMPLATE_CSV_COLUMNS) => POD_TEMPLATE_CSV_COLUMNS[kind].map((c) => c.key);
const csvOf = (kind: keyof typeof POD_TEMPLATE_CSV_COLUMNS, rows: Array<Record<string, string>>) =>
  toCsv(header(kind), rows.map((row) => header(kind).map((key) => row[key] ?? '')));

const descTemplate = (id: string, name: string) => ({
  id,
  name,
  contentHtml: '<p>Áo "đẹp", giá tốt\nmới</p>',
  displayOrder: 1,
  note: null,
  tokens: [{ code: 'SIZE', label: 'Size', value: 'S, M', sortOrder: 0 }],
});

describe('Export theo dòng', () => {
  it('1 row ⇒ CSV đúng 1 dòng dữ liệu, KHÔNG có id / organizationId / audit', async () => {
    const { service, prisma } = build();
    prisma.podDescriptionTemplate.findMany.mockResolvedValue([descTemplate('d1', 'Mô tả 1')]);

    const { csv, count } = await service.exportRowsCsv(ORG, 'DESCRIPTION', ['d1']);
    const [head, ...rows] = parseCsv(csv);

    expect(count).toBe(1);
    expect(rows).toHaveLength(1);
    expect(head).toEqual(header('DESCRIPTION'));
    expect(head).not.toEqual(expect.arrayContaining(['id', 'organizationId', 'createdBy', 'createdAt']));
    expect(csv).not.toContain('d1');
    expect(rows[0][head.indexOf('contentHtml')]).toBe('<p>Áo "đẹp", giá tốt\nmới</p>');
    expect(prisma.podDescriptionTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['d1'] }, organizationId: ORG, deletedAt: null } }),
    );
  });

  it('nhiều row ⇒ chỉ các row đã chọn, theo thứ tự chọn, id trùng chỉ xuất một lần (MỘT truy vấn)', async () => {
    const { service, prisma } = build();
    prisma.podDescriptionTemplate.findMany.mockResolvedValue([descTemplate('d1', 'A'), descTemplate('d3', 'C')]);

    const { csv } = await service.exportRowsCsv(ORG, 'DESCRIPTION', ['d3', 'd1', 'd3']);
    const [, ...rows] = parseCsv(csv);

    expect(rows.map((row) => row[0])).toEqual(['C', 'A']);
    expect(prisma.podDescriptionTemplate.findMany).toHaveBeenCalledTimes(1);
  });

  it('🔴 id không tồn tại / của tổ chức khác ⇒ 404 và KHÔNG xuất gì', async () => {
    const { service, prisma } = build();
    prisma.podDescriptionTemplate.findMany.mockResolvedValue([descTemplate('d1', 'A')]);
    await expect(service.exportRowsCsv(ORG, 'DESCRIPTION', ['d1', 'other-org-id'])).rejects.toMatchObject({
      response: { code: 'POD_TEMPLATE_EXPORT_NOT_FOUND' },
    });
  });

  it('Image: xuất URL công khai để chép sang tổ chức khác; không xuất key lưu trữ nội bộ', async () => {
    const { service, prisma } = build();
    prisma.podImageTemplate.findMany.mockResolvedValue([
      {
        id: 'i1',
        name: 'Mockup',
        description: null,
        displayOrder: 0,
        items: [{ title: 'Front', assetType: 'MAIN_FRONT', fileId: 'f1', imageUrl: 'https://cdn.test/f1.png', imageKey: 'secret/key.png', width: 10, height: 20, isRequired: true }],
      },
    ]);
    const { csv } = await service.exportRowsCsv(ORG, 'IMAGE', ['i1']);
    const [head, row] = parseCsv(csv);
    const images = JSON.parse(row[head.indexOf('images')]) as Array<Record<string, unknown>>;
    expect(images[0]).toEqual({ title: 'Front', assetType: 'MAIN_FRONT', fileId: 'f1', imageUrl: 'https://cdn.test/f1.png', width: 10, height: 20, isRequired: true });
    expect(csv).not.toContain('secret/key.png');
  });
});

describe('Import theo dòng', () => {
  it('tạo template cho từng dòng trong file vào tổ chức của token; không xoá / sửa gì khác', async () => {
    const { service, templates, prisma } = build();
    const csv = csvOf('DESCRIPTION', [
      { name: 'Mô tả “A”, Unicode 🎃', contentHtml: '<p>x,y\n"z"</p>', tokens: '[{"code":"SIZE","label":"Size","value":"S"}]' },
      { name: 'B', contentHtml: '<p>b</p>' },
    ]);

    const result = await service.importRowsCsv(ORG, USER, 'DESCRIPTION', csv);

    expect(result).toMatchObject({ total: 2, created: 2, failed: 0, errors: [] });
    expect(templates.createDescriptionTemplate).toHaveBeenCalledTimes(2);
    const [org, user, dto] = templates.createDescriptionTemplate.mock.calls[0] as [string, string, Record<string, unknown>];
    expect([org, user]).toEqual([ORG, USER]);
    expect(dto).toMatchObject({ name: 'Mô tả “A”, Unicode 🎃', contentHtml: '<p>x,y\n"z"</p>' });
    // Không có lệnh xoá nào ngoài phạm vi file.
    expect(prisma.podSkuTemplateItem.deleteMany).not.toHaveBeenCalled();
  });

  it('trùng tên trong tổ chức ⇒ thêm hậu tố (quy tắc import hiện có), không ghi đè', async () => {
    const { service, templates, prisma } = build();
    prisma.podDescriptionTemplate.count.mockImplementation(({ where }: { where: { name: string } }) =>
      Promise.resolve(where.name === 'A' ? 1 : 0),
    );
    await service.importRowsCsv(ORG, USER, 'DESCRIPTION', csvOf('DESCRIPTION', [{ name: 'A', contentHtml: 'x' }]));
    expect((templates.createDescriptionTemplate.mock.calls[0] as [string, string, { name: string }])[2].name).toBe('A (import 1)');
  });

  it('lỗi theo dòng: thiếu trường bắt buộc / JSON hỏng / số sai ⇒ báo số dòng, dòng khác vẫn nạp', async () => {
    const { service, templates } = build();
    const csv = csvOf('SKU', [
      { name: 'OK', variants: '[{"name":"Color","values":[{"value":"Black"}]}]' },
      { name: 'Bad JSON', variants: '[{"name":' },
      { name: 'Bad number', variants: '[]', defaultRetailPrice: 'mười' },
      { name: '', variants: '[{"name":"Size","values":[{"value":"S"}]}]' },
    ]);
    const result = await service.importRowsCsv(ORG, USER, 'SKU', csv);

    expect(result.created).toBe(1);
    expect(result.failed).toBe(3);
    expect(result.errors.map((error) => error.row)).toEqual([3, 4, 5]);
    expect(result.errors[0].message).toContain('variants');
    expect(result.errors[1].message).toContain('defaultRetailPrice');
    expect(templates.createSkuTemplate).toHaveBeenCalledTimes(1);
  });

  it('file của tab khác / thiếu cột ⇒ 400 rõ ràng, không nạp dòng nào', async () => {
    const { service, templates } = build();
    const skuCsv = csvOf('SKU', [{ name: 'X', variants: '[]' }]);
    await expect(service.importRowsCsv(ORG, USER, 'IMAGE', skuCsv)).rejects.toMatchObject({
      response: { code: 'POD_TEMPLATE_CSV_COLUMNS_MISMATCH' },
    });
    await expect(service.importRowsCsv(ORG, USER, 'DESCRIPTION', toCsv(['name'], [['A']]))).rejects.toMatchObject({
      response: { code: 'POD_TEMPLATE_CSV_COLUMNS_MISMATCH' },
    });
    await expect(service.importRowsCsv(ORG, USER, 'DESCRIPTION', toCsv(header('DESCRIPTION'), []))).rejects.toMatchObject({
      response: { code: 'POD_TEMPLATE_CSV_EMPTY' },
    });
    expect(templates.createSkuTemplate).not.toHaveBeenCalled();
  });

  it('🔴 Image sang tổ chức khác: id nguồn KHÔNG dùng; ảnh chép từ URL thành file của tổ chức đích', async () => {
    const { service, images, imageUrls } = build();
    const csv = csvOf('IMAGE', [
      {
        name: 'Mockup',
        images: JSON.stringify([{ title: 'Front', assetType: 'MAIN_FRONT', fileId: 'file-of-org-b', imageUrl: 'https://cdn.test/src.png', isRequired: true }]),
      },
    ]);
    const result = await service.importRowsCsv(ORG, USER, 'IMAGE', csv);

    expect(result.created).toBe(1);
    expect(imageUrls.importImage).toHaveBeenCalledWith(ORG, USER, 'https://cdn.test/src.png');
    const rows = (images.restoreItems.mock.calls[0] as [string, string, Array<{ fileId: string; imageKey: string; assetType: string }>])[2];
    expect(rows[0].fileId).toBe(COPIED_0);
    expect(rows[0].fileId).not.toBe('file-of-org-b');
    expect(rows[0]).toMatchObject({ imageKey: `k/${COPIED_0}.png`, assetType: PodImageAssetType.MAIN_FRONT });
  });

  it('Image cùng tổ chức: dùng lại đúng file, không chép', async () => {
    const { service, images, imageUrls, files } = build();
    files.set('f1', { id: 'f1', organizationId: ORG, publicUrl: 'https://cdn.test/f1.png', objectKey: 'k/f1.png', mimeType: 'image/png', fileSize: 5 });
    const csv = csvOf('IMAGE', [{ name: 'M', images: JSON.stringify([{ title: 'F', assetType: 'MAIN_FRONT', fileId: 'f1', imageUrl: 'https://cdn.test/f1.png' }]) }]);
    await service.importRowsCsv(ORG, USER, 'IMAGE', csv);
    expect(imageUrls.importImage).not.toHaveBeenCalled();
    expect((images.restoreItems.mock.calls[0] as [string, string, Array<{ fileId: string }>])[2][0].fileId).toBe('f1');
  });

  it('Image: ảnh không dùng lại / chép được ⇒ lỗi CẢ dòng (không tạo template rỗng)', async () => {
    const { service, images } = build();
    const csv = csvOf('IMAGE', [
      { name: 'No url', images: JSON.stringify([{ title: 'F', assetType: 'MAIN_FRONT', fileId: 'foreign' }]) },
      { name: 'Broken', images: JSON.stringify([{ title: 'F', assetType: 'MAIN_FRONT', imageUrl: 'https://cdn.test/broken.png' }]) },
      { name: 'Bad type', images: JSON.stringify([{ title: 'F', assetType: 'NOPE', imageUrl: 'https://cdn.test/x.png' }]) },
    ]);
    const result = await service.importRowsCsv(ORG, USER, 'IMAGE', csv);
    expect(result.created).toBe(0);
    expect(result.errors.map((error) => error.row)).toEqual([2, 3, 4]);
    expect(images.create).not.toHaveBeenCalled();
  });

  it('Image: ghi ảnh hỏng sau khi tạo ⇒ xoá template vừa tạo (dòng nguyên tử)', async () => {
    const { service, images, prisma, files } = build();
    files.set('f1', { id: 'f1', organizationId: ORG, publicUrl: null, objectKey: 'k', mimeType: 'image/png', fileSize: 1 });
    images.restoreItems.mockRejectedValue(new Error('db down'));
    const csv = csvOf('IMAGE', [{ name: 'M', images: JSON.stringify([{ title: 'F', assetType: 'MAIN_FRONT', fileId: 'f1' }]) }]);
    const result = await service.importRowsCsv(ORG, USER, 'IMAGE', csv);
    expect(result.failed).toBe(1);
    expect(prisma.podImageTemplate.delete).toHaveBeenCalledWith({ where: { id: 'new-img' } });
  });

  it('Category sang tổ chức khác: kho map theo mã TikTok; size chart chép từ URL; không có kho ⇒ cảnh báo kèm số dòng', async () => {
    const { service, templates } = build();
    const csv = csvOf('CATEGORY', [
      {
        name: 'Tee',
        market: 'US',
        tiktokCategoryId: '601226',
        brandMode: 'NONE',
        tiktokWarehouseId: 'WH-1',
        sizeChartFileId: 'foreign',
        sizeChartUrl: 'https://cdn.test/chart.png',
        attributes: '[]',
      },
    ]);
    const result = await service.importRowsCsv(ORG, USER, 'CATEGORY', csv);
    expect(result.created).toBe(1);
    const dto = (templates.createCategoryTemplate.mock.calls[0] as [string, string, Record<string, unknown>])[2];
    expect(dto).toMatchObject({ brandMode: 'NONE', sizeChartFileId: COPIED_0 });
    expect(dto.warehouseId).toBeUndefined();
    expect(result.warnings).toEqual([expect.stringMatching(/^Dòng 2: .*kho WH-1/)]);
  });
});
