import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageProviderName } from '@prisma/client';
import { AuthModule } from '../auth/auth.module';
import { StorageProvider } from './interfaces/storage-provider.interface';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';
import { LocalDiskProvider } from './providers/local-disk.provider';
import { StorageController } from './storage.controller';
import { StorageMapper } from './storage.mapper';
import { StorageRepository } from './storage.repository';
import { StorageService } from './storage.service';

/**
 * Chọn nhà cung cấp lưu trữ theo cấu hình `STORAGE_PROVIDER`.
 *
 * ĐÂY LÀ NƠI DUY NHẤT quyết định dùng nhà cung cấp nào. Muốn chuyển R2 → S3 → MinIO → GCS
 * chỉ cần viết thêm một implementation của `StorageProvider` và thêm một nhánh ở đây;
 * KHÔNG module nghiệp vụ nào phải sửa vì tất cả đều gọi qua `StorageService`.
 */
function createStorageProvider(config: ConfigService): StorageProvider {
  const provider = config.get<string>('storage.provider', StorageProviderName.LOCAL_DISK);

  switch (provider) {
    case StorageProviderName.CLOUDFLARE_R2:
      return new CloudflareR2Provider(config);
    case StorageProviderName.LOCAL_DISK:
      return new LocalDiskProvider(config);
    default:
      // Env đã được Joi validate; nhánh này chỉ chạm tới nếu thêm giá trị mới mà quên nối dây.
      throw new Error(`STORAGE_PROVIDER không được hỗ trợ: ${provider}`);
  }
}

/**
 * StorageModule — module lõi dùng chung cho việc lưu trữ file toàn hệ thống.
 *
 * Mọi module nghiệp vụ (Employee Avatar, Order Design, POD Design, Shipping Label,
 * Excel Import/Export) đều upload QUA `StorageService`, tuyệt đối không tự gọi
 * Cloudflare R2 hay ghi file trực tiếp.
 *
 * `@Global` để không phải import lặp lại ở từng module nghiệp vụ (module hạ tầng,
 * giống PrismaModule/RedisModule).
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [StorageController],
  providers: [
    { provide: StorageProvider, useFactory: createStorageProvider, inject: [ConfigService] },
    StorageRepository,
    StorageMapper,
    StorageService,
  ],
  exports: [StorageService, StorageMapper],
})
export class StorageModule {}
