/**
 * Bổ sung cho design ĐÃ có trước khi tính năng thu nhỏ ảnh ra đời:
 *
 *  1. Design cũ nguồn URL (`source_url`, toàn link Google Drive `/view`): link đó trả về TRANG HTML, nên ảnh trên Order
 *     List bị vỡ và nhà cung cấp cũng nhận đúng link đó. Script tải qua `ProductDesignService.setUrl`, tức CÙNG đường với
 *     nhập URL trên màn hình: kiểm tra chữ ký file, lưu Storage, tăng version. File không công khai ⇒ giữ nguyên design
 *     cũ, in lý do.
 *  2. Design đã có file nhưng chưa có bản thu nhỏ: đọc file gốc rồi tạo thumbnail. File gốc không đổi.
 *
 * Mặc định CHỈ LIỆT KÊ (dry-run). Ghi thật phải truyền `--apply`. Chạy lại an toàn: dòng đã xử lý không còn trong danh sách.
 * Từng file một, để RAM server không cộng dồn với file in vài chục MB.
 *
 * Chạy:
 *   node -r ts-node/register -r dotenv/config scripts/backfill-design-media.ts            # dry-run
 *   node -r ts-node/register -r dotenv/config scripts/backfill-design-media.ts --apply    # ghi
 *   … --org <organizationId> --limit 50
 */
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { fetchRemoteFile } from '../src/common/http/safe-remote-fetch';
import { PrismaService } from '../src/database/prisma.service';
import { ProductDesignService } from '../src/modules/fulfillment/services/product-design.service';
import { StorageService } from '../src/modules/storage/storage.service';

const DOWNLOAD_TIMEOUT_MS = 180_000;
const MAX_BYTES = 200 * 1024 * 1024;
const ALL_SHOPS = { allShops: true, accountIds: [], shopIds: [] };

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const organizationId = argValue('--org');
  const limit = Number(argValue('--limit') ?? 1000);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit phải là số nguyên ≥ 1');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  // Dùng chung AppModule với server ⇒ tắt mọi job định kỳ trong tiến trình này.
  const scheduler = app.get(SchedulerRegistry);
  scheduler.getCronJobs().forEach((job) => void job.stop());
  scheduler.getIntervals().forEach((name) => scheduler.deleteInterval(name));
  scheduler.getTimeouts().forEach((name) => scheduler.deleteTimeout(name));
  try {
    const prisma = app.get(PrismaService);
    const designs = app.get(ProductDesignService);
    const storage = app.get(StorageService);
    const scope: Prisma.FulfillmentProductDesignWhereInput = {
      deletedAt: null,
      ...(organizationId ? { organizationId } : {}),
    };

    const urlDesigns = await prisma.fulfillmentProductDesign.findMany({
      where: { ...scope, storageFileId: null, sourceUrl: { not: null } },
      select: {
        id: true,
        organizationId: true,
        tiktokProductId: true,
        tiktokSkuId: true,
        sellerSku: true,
        placement: true,
        sourceUrl: true,
        updatedBy: true,
        createdBy: true,
      },
      take: limit,
    });
    console.log(`[1] Design nguồn URL chưa có file: ${urlDesigns.length}`);
    let imported = 0;
    const failures: string[] = [];
    for (const design of urlDesigns) {
      if (!apply) continue;
      const actor = design.updatedBy ?? design.createdBy;
      if (!actor) {
        failures.push(`${design.id}: thiếu người tạo design`);
        continue;
      }
      try {
        await designs.setUrl(
          design.organizationId,
          actor,
          {
            tiktokProductId: design.tiktokProductId ?? '',
            tiktokSkuId: design.tiktokSkuId ?? undefined,
            sellerSku: design.sellerSku ?? undefined,
          },
          design.placement,
          design.sourceUrl as string,
          ALL_SHOPS,
        );
        imported += 1;
      } catch (error) {
        const reason = (error as { response?: { message?: string } }).response?.message ?? (error as Error).message;
        failures.push(`${design.id}: ${reason}`);
      }
    }
    if (apply) {
      console.log(`    Đã lưu vào Storage: ${imported}, không tải được (giữ nguyên): ${failures.length}`);
      failures.forEach((line) => console.log(`    - ${line}`));
    }

    const files = await prisma.storageFile.findMany({
      where: {
        deletedAt: null,
        thumbnailObjectKey: null,
        publicUrl: { not: null },
        ...(organizationId ? { organizationId } : {}),
        productDesigns: { some: { deletedAt: null } },
      },
      select: { id: true, objectKey: true, publicUrl: true, fileSize: true },
      take: limit,
    });
    const totalMb = files.reduce((sum, file) => sum + file.fileSize, 0) / 1024 / 1024;
    console.log(`[2] File design chưa có bản thu nhỏ: ${files.length} (${totalMb.toFixed(0)} MB cần đọc)`);
    if (!apply) {
      console.log('Dry-run: chưa ghi gì. Thêm --apply để chạy thật.');
      return;
    }
    let done = 0;
    let skipped = 0;
    for (const file of files) {
      try {
        const remote = await fetchRemoteFile(file.publicUrl as string, {
          maxBytes: MAX_BYTES,
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          maxRedirects: 2,
        });
        if (await storage.attachThumbnail(file, remote.buffer)) done += 1;
        else skipped += 1;
      } catch (error) {
        skipped += 1;
        console.log(`    - ${file.id}: ${(error as Error).message}`);
      }
    }
    console.log(`    Đã tạo: ${done}, bỏ qua: ${skipped}`);
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
