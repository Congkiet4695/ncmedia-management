import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import {
  TIKTOK_IMAGE_USE_CASE,
  type TiktokImageUseCase,
} from '../../tiktok-sdk/tiktok-sdk.constants';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';

/**
 * Một tấm ảnh người dùng gửi lên khi sửa sản phẩm.
 *
 * Ba nguồn, và thứ tự ưu tiên chính là thứ tự rẻ nhất:
 *  - `uri` — ảnh ĐANG nằm trên sản phẩm, TikTok đã có. Không phải làm gì.
 *  - `fileId` — file trong Storage Module (người dùng vừa tải lên, hoặc ảnh của bộ ảnh mẫu).
 *  - Không có gì dùng được ⇒ lỗi, không im lặng bỏ qua.
 */
export interface MediaImageInput {
  uri?: string | null;
  fileId?: string | null;
}

/** Kết quả upload một nhóm file: thành công thì có uri, hỏng thì có lý do. */
export interface MediaResolveFailure {
  /** Nhãn để người dùng biết tấm nào — tên file, hoặc "Ảnh 3". */
  label: string;
  message: string;
}

export class PodProductMediaFailedException extends BadRequestException {
  constructor(failures: MediaResolveFailure[]) {
    super({
      code: 'POD_PRODUCT_MEDIA_UPLOAD_FAILED',
      message:
        failures.length === 1
          ? `Không tải được ${failures[0].label} lên TikTok: ${failures[0].message}`
          : `Không tải được ${failures.length} tệp lên TikTok. Chưa có thay đổi nào được lưu.`,
      failures,
    });
  }
}

/**
 * PodProductMediaService — đưa ảnh/video từ Storage lên TikTok để lấy `uri` / `id`.
 *
 * ```
 *   ảnh đã có trên sản phẩm  ─── uri sẵn ──────────────┐
 *   ảnh của bộ ảnh mẫu       ─── uri đã cache ─────────┤
 *   file người dùng vừa tải  ─── Upload Product Image ─┴──→  uri  →  partial_edit
 * ```
 *
 * 🔴 **Chạy TRƯỚC khi diff, và TRƯỚC khi gọi partial_edit.** Sửa sản phẩm chỉ được gọi TikTok
 * một lần duy nhất; nếu một tấm ảnh hỏng thì phải hỏng ở đây, lúc chưa có gì thay đổi trên
 * sàn. Upload xong mới phát hiện hỏng giữa chừng nghĩa là sản phẩm đã đổi một nửa.
 *
 * 🔴 **Không upload lại thứ TikTok đã có.** Ảnh của bộ ảnh mẫu lưu sẵn `tiktokImageUri` sau
 * lần publish đầu; dùng lại nó thay vì đẩy đúng tấm mockup đó lên lần thứ hai mươi. Đây cũng
 * là cách `PodListingPublisherService` làm — cùng một bảng, cùng một cột.
 */
@Injectable()
export class PodProductMediaService {
  private readonly logger = new Logger(PodProductMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly productApi: TiktokProductApiService,
  ) {}

  /**
   * Quy cả danh sách ảnh về `uri`, GIỮ NGUYÊN thứ tự.
   *
   * Thứ tự là dữ liệu, không phải chi tiết trình bày: TikTok lấy tấm đầu tiên làm ảnh đại
   * diện, nên đảo thứ tự trong lúc upload song song là đổi ảnh đại diện của sản phẩm.
   */
  async resolveImages(
    organizationId: string,
    ctx: TiktokShopContext,
    images: MediaImageInput[],
    useCase: TiktokImageUseCase = TIKTOK_IMAGE_USE_CASE.MAIN_IMAGE,
  ): Promise<string[]> {
    if (images.length === 0) return [];

    const cached = await this.readCachedUris(
      organizationId,
      images.map((image) => image.fileId).filter((id): id is string => Boolean(id)),
      useCase,
    );

    const failures: MediaResolveFailure[] = [];
    const resolved = await Promise.all(
      images.map(async (image, index) => {
        const label = `Ảnh ${index + 1}`;
        if (image.uri) return image.uri;

        const hit = image.fileId ? cached.get(image.fileId) : undefined;
        if (hit) return hit;

        if (!image.fileId) {
          failures.push({ label, message: 'Thiếu cả `uri` lẫn `fileId`' });
          return null;
        }

        try {
          const uri = await this.uploadStorageImage(organizationId, ctx, image.fileId, useCase);
          await this.cacheUri(organizationId, image.fileId, uri, useCase);
          return uri;
        } catch (error) {
          failures.push({ label, message: describe(error) });
          return null;
        }
      }),
    );

    // 🔴 Một tấm hỏng là DỪNG cả lượt lưu: gửi bộ ảnh thiếu tấm đó lên TikTok chính là xoá
    // nó khỏi sản phẩm — mảng `main_images` thay toàn bộ, không phải thêm vào.
    if (failures.length > 0) throw new PodProductMediaFailedException(failures);

    return resolved.filter((uri): uri is string => Boolean(uri));
  }

  /** Bảng size — dùng `SIZE_CHART_IMAGE`, không phải `MAIN_IMAGE`. */
  async resolveSizeChart(
    organizationId: string,
    ctx: TiktokShopContext,
    image: MediaImageInput,
  ): Promise<string> {
    if (image.uri) return image.uri;
    if (!image.fileId) {
      throw new PodProductMediaFailedException([
        { label: 'Bảng size', message: 'Thiếu cả `uri` lẫn `fileId`' },
      ]);
    }

    const cached = await this.readCachedUris(
      organizationId,
      [image.fileId],
      TIKTOK_IMAGE_USE_CASE.SIZE_CHART_IMAGE,
    );
    const hit = cached.get(image.fileId);
    if (hit) return hit;

    try {
      const uri = await this.uploadStorageImage(
        organizationId,
        ctx,
        image.fileId,
        TIKTOK_IMAGE_USE_CASE.SIZE_CHART_IMAGE,
      );
      await this.cacheUri(
        organizationId,
        image.fileId,
        uri,
        TIKTOK_IMAGE_USE_CASE.SIZE_CHART_IMAGE,
      );
      return uri;
    } catch (error) {
      throw new PodProductMediaFailedException([
        { label: 'Bảng size', message: describe(error) },
      ]);
    }
  }

  /**
   * Video — Upload Product File trả về **ID**, không phải `uri`.
   *
   * Không có cache: video không dùng lại giữa các sản phẩm như bộ ảnh mockup, và một lần
   * upload nhầm video cũ là sản phẩm hiển thị sai hàng.
   */
  async resolveVideo(
    organizationId: string,
    ctx: TiktokShopContext,
    fileId: string,
  ): Promise<string> {
    try {
      const file = await this.storage.download(organizationId, fileId);
      const { data } = await this.productApi.uploadFile(ctx, {
        buffer: file.body,
        fileName: file.file.originalName || `${fileId}.mp4`,
      });
      if (!data.id) throw new Error('TikTok không trả về id cho video');
      return data.id;
    } catch (error) {
      throw new PodProductMediaFailedException([{ label: 'Video', message: describe(error) }]);
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async uploadStorageImage(
    organizationId: string,
    ctx: TiktokShopContext,
    fileId: string,
    useCase: TiktokImageUseCase,
  ): Promise<string> {
    const { file, body } = await this.storage.download(organizationId, fileId);
    const { data } = await this.productApi.uploadImage(
      ctx,
      {
        buffer: body,
        fileName: file.originalName || `${fileId}.jpg`,
        contentType: file.mimeType,
      },
      useCase,
    );
    if (!data.uri) throw new Error('TikTok không trả về uri');
    return data.uri;
  }

  /**
   * `uri` đã có sẵn cho những file này chưa.
   *
   * 🔴 Chỉ dùng cache cho **MAIN_IMAGE**: phía TikTok, cùng một tấm ảnh tải lên với hai
   * `use_case` khác nhau cho ra hai `uri` khác nhau. Lấy `uri` của ảnh sản phẩm gán làm bảng
   * size là gửi một mã TikTok từ chối — đúng lỗi đã từng xảy ra ở luồng Bulk Listing.
   */
  private async readCachedUris(
    organizationId: string,
    fileIds: string[],
    useCase: TiktokImageUseCase,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (fileIds.length === 0 || useCase !== TIKTOK_IMAGE_USE_CASE.MAIN_IMAGE) return result;

    const rows = await this.prisma.podImageTemplateItem.findMany({
      where: {
        organizationId,
        fileId: { in: [...new Set(fileIds)] },
        tiktokImageUri: { not: null },
      },
      select: { fileId: true, tiktokImageUri: true },
    });
    for (const row of rows) {
      if (row.tiktokImageUri) result.set(row.fileId, row.tiktokImageUri);
    }
    return result;
  }

  /** Ghi `uri` trở lại bộ ảnh mẫu để lần sau khỏi upload. Không phải ảnh mẫu thì bỏ qua. */
  private async cacheUri(
    organizationId: string,
    fileId: string,
    uri: string,
    useCase: TiktokImageUseCase,
  ): Promise<void> {
    if (useCase !== TIKTOK_IMAGE_USE_CASE.MAIN_IMAGE) return;
    try {
      await this.prisma.podImageTemplateItem.updateMany({
        where: { organizationId, fileId, tiktokImageUri: null },
        data: { tiktokImageUri: uri, uploadedAt: new Date() },
      });
    } catch (error) {
      // Cache hỏng KHÔNG được làm hỏng lượt lưu — lần sau upload lại là cùng.
      this.logger.warn({
        module: 'pod-product',
        operation: 'media.cache.fail',
        organizationId,
        fileId,
        msg: describe(error),
      });
    }
  }
}

function describe(error: unknown): string {
  const candidate = error as { tiktokMessage?: string; message?: string };
  return candidate?.tiktokMessage ?? candidate?.message ?? 'Lỗi không xác định';
}
