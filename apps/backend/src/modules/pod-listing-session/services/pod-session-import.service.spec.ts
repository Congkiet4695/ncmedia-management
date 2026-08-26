import { BadRequestException } from '@nestjs/common';
import { PodListingSessionStatus } from '@prisma/client';
import { Workbook } from 'exceljs';
import { POD_SCOPE_SYSTEM } from '../../pod-tiktok/services/pod-access-scope.service';
import { PodSessionImportService } from './pod-session-import.service';

/**
 * Đọc file import — **đúng 11 cột `title` + `URL1..URL10`**, không hơn.
 *
 * 🔴 Đây là chỗ duy nhất dữ liệu ngoài đi vào hệ thống, và nó phải cư xử đúng với những file
 * mà người thật gửi: cột viết hoa/thường lẫn lộn, ô trống ở giữa, URL trùng, dòng thiếu tên,
 * và những cột thừa mà hệ thống KHÔNG được đoán ý.
 */

/** Dựng file .xlsx trong bộ nhớ từ mảng dòng. */
async function buildFile(rows: unknown[][]): Promise<Express.Multer.File> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Products');
  for (const row of rows) sheet.addRow(row);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { originalname: 'test.xlsx', buffer } as Express.Multer.File;
}

/** Service với Prisma giả; trả kèm mọi bản ghi đã được tạo để kiểm tra. */
function buildService() {
  const created: Array<{ title: string; importOrder: number; urls: string[] }> = [];

  const prisma = {
    podListingSessionProduct: {
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(({ data }: { data: Record<string, never> }) => {
        const images = (data.images as unknown as { create: Array<{ imageUrl: string }> }).create;
        created.push({
          title: data.title,
          importOrder: data.importOrder,
          urls: images.map((image) => image.imageUrl),
        });
        return Promise.resolve({ id: `p-${created.length}`, _count: { images: images.length } });
      }),
    },
    podListingSession: { update: jest.fn().mockResolvedValue({}) },
  };

  const sessions = {
    get: jest.fn().mockResolvedValue({ id: 'session-1', status: PodListingSessionStatus.DRAFT }),
  };

  return {
    service: new PodSessionImportService(prisma as never, sessions as never),
    created,
  };
}

const HEADER = [
  'title',
  'URL1',
  'URL2',
  'URL3',
  'URL4',
  'URL5',
  'URL6',
  'URL7',
  'URL8',
  'URL9',
  'URL10',
];

describe('PodSessionImportService — file 11 cột', () => {
  it('mỗi dòng là MỘT sản phẩm, URL1..URL10 thành danh sách ảnh gốc', async () => {
    const { service, created } = buildService();
    const file = await buildFile([
      HEADER,
      ['Vintage Poster', 'https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
      ['Retro Tee', 'https://cdn.example/c.jpg'],
    ]);

    const result = await service.import('org-1', 'user-1', 'session-1', file, {}, POD_SCOPE_SYSTEM);

    expect(result.createdProducts).toBe(2);
    expect(result.createdImages).toBe(3);
    expect(created[0]).toEqual({
      title: 'Vintage Poster',
      importOrder: 0,
      urls: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
    });
    // Thứ tự trong file = thứ tự trong lượt đăng.
    expect(created[1].importOrder).toBe(1);
  });

  it('ô URL trống ở giữa bị bỏ qua, thứ tự các URL còn lại giữ nguyên', async () => {
    const { service, created } = buildService();
    const file = await buildFile([
      HEADER,
      ['Poster', 'https://cdn.example/a.jpg', '', 'https://cdn.example/c.jpg'],
    ]);

    await service.import('org-1', 'user-1', 'session-1', file, {}, POD_SCOPE_SYSTEM);

    expect(created[0].urls).toEqual(['https://cdn.example/a.jpg', 'https://cdn.example/c.jpg']);
  });

  it('URL trùng nhau chỉ giữ một lần (đẩy hai lần cùng một ảnh là hai lần upload vô ích)', async () => {
    const { service, created } = buildService();
    const file = await buildFile([
      HEADER,
      ['Poster', 'https://cdn.example/a.jpg', 'https://cdn.example/a.jpg'],
    ]);

    await service.import('org-1', 'user-1', 'session-1', file, {}, POD_SCOPE_SYSTEM);

    expect(created[0].urls).toHaveLength(1);
  });

  it('giá trị không phải http(s) bị bỏ — không nhập vào một đường dẫn không tải được', async () => {
    const { service, created } = buildService();
    const file = await buildFile([
      HEADER,
      ['Poster', 'C:\\anh\\a.jpg', 'https://cdn.example/a.jpg'],
    ]);

    await service.import('org-1', 'user-1', 'session-1', file, {}, POD_SCOPE_SYSTEM);

    expect(created[0].urls).toEqual(['https://cdn.example/a.jpg']);
  });

  it('tên cột không phân biệt hoa thường và khoảng trắng thừa', async () => {
    const { service, created } = buildService();
    const file = await buildFile([
      ['Title', 'url 1', 'URL2'],
      ['Poster', 'https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
    ]);

    await service.import('org-1', 'user-1', 'session-1', file, {}, POD_SCOPE_SYSTEM);

    expect(created[0].urls).toHaveLength(2);
  });

  it('🔴 cột lạ bị BỎ QUA — hệ thống không đọc thêm bất kỳ trường nào', async () => {
    const { service, created } = buildService();
    const file = await buildFile([
      ['title', 'URL1', 'price', 'description', 'sku'],
      ['Poster', 'https://cdn.example/a.jpg', '19.99', '<p>hi</p>', 'SKU-1'],
    ]);

    await service.import('org-1', 'user-1', 'session-1', file, {}, POD_SCOPE_SYSTEM);

    expect(created[0]).toEqual({
      title: 'Poster',
      importOrder: 0,
      urls: ['https://cdn.example/a.jpg'],
    });
  });

  it('dòng thiếu title bị bỏ kèm SỐ DÒNG, các dòng còn lại vẫn vào', async () => {
    const { service, created } = buildService();
    const file = await buildFile([
      HEADER,
      ['', 'https://cdn.example/a.jpg'],
      ['Poster', 'https://cdn.example/b.jpg'],
    ]);

    const result = await service.import('org-1', 'user-1', 'session-1', file, {}, POD_SCOPE_SYSTEM);

    expect(result.skippedRows).toBe(1);
    expect(result.errors[0].row).toBe(2);
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe('Poster');
  });

  it('sản phẩm không có URL nào vẫn nhập được (ảnh sẽ lấy từ Image Template)', async () => {
    const { service, created } = buildService();
    const file = await buildFile([HEADER, ['Poster']]);

    await service.import('org-1', 'user-1', 'session-1', file, {}, POD_SCOPE_SYSTEM);

    expect(created[0].urls).toEqual([]);
  });

  it('file thiếu cột title ⇒ từ chối cả file, không nhập nửa vời', async () => {
    const { service } = buildService();
    const file = await buildFile([['URL1'], ['https://cdn.example/a.jpg']]);

    await expect(
      service.import('org-1', 'user-1', 'session-1', file, {}, POD_SCOPE_SYSTEM),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('file mẫu tải về đúng 11 cột, không thêm cột nào', async () => {
    const { service } = buildService();
    const buffer = await service.buildTemplateFile();

    const workbook = new Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const header = workbook.worksheets[0].getRow(1).values as unknown[];

    // `values` của ExcelJS đánh chỉ số từ 1 nên phần tử 0 luôn rỗng.
    expect(header.slice(1)).toEqual(HEADER);
  });
});
