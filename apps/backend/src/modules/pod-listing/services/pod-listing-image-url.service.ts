import {
  BadRequestException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, StorageModuleName, StorageReferenceType } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  assertFetchableUrl,
  fetchRemoteFile,
  RemoteFetchError,
  type RemoteFetchFailure,
  type RemoteFetchOptions,
  type RemoteFile,
} from '../../../common/http/safe-remote-fetch';
import { isGoogleDriveUrl, toDirectDownloadUrl } from '../../../common/utils/google-drive-url.util';
import { detectImageMime, IMAGE_MIME_EXTENSION } from '../../../common/utils/image-signature.util';
import { StorageFileDto } from '../../storage/dto/storage.dto';
import { StorageMapper } from '../../storage/storage.mapper';
import { StorageService } from '../../storage/storage.service';
import {
  POD_LISTING_IMAGE_URL_MAX_BYTES,
  POD_LISTING_IMAGE_URL_MAX_REDIRECTS,
  POD_LISTING_IMAGE_URL_TIMEOUT_MS,
} from '../constants/pod-listing.constants';

/** Lỗi do CHÍNH URL (sai dạng / nội bộ) — người dùng sửa link là xong ⇒ 400. */
const URL_INVALID: readonly RemoteFetchFailure[] = [
  'UNSUPPORTED_PROTOCOL',
  'CREDENTIALS_IN_URL',
  'PORT_NOT_ALLOWED',
  'NOT_PUBLIC',
];

/**
 * Khoá của một URL nguồn: bỏ `#…`, host chữ thường, query giữ nguyên (có thể là ảnh khác), cùng luật so khớp với form.
 * Link Drive đổi về link tải nên các dạng link của cùng một file là một. Lưu sha256 chứ không lưu URL: URL hay mang token ký.
 */
export function sourceUrlHashOf(rawUrl: string): string {
  const url = new URL(toDirectDownloadUrl(rawUrl));
  url.hash = '';
  return createHash('sha256').update(url.toString()).digest('hex');
}

/** Máy chủ ảnh hay khai chung chung cho ảnh thật — chấp nhận, rồi tin CHỮ KÝ file. */
const GENERIC_CONTENT_TYPES = ['', 'application/octet-stream', 'binary/octet-stream'];

export class PodListingImageUrlInvalidException extends BadRequestException {
  constructor(reason: string, message: string) {
    super({ code: 'POD_LISTING_IMAGE_URL_INVALID', message, details: { reason } });
  }
}

/** URL hợp lệ về hình thức nhưng KHÔNG lấy được ảnh dùng được (hết hạn, cần đăng nhập, không phải ảnh…). */
export class PodListingImageUrlFetchFailedException extends UnprocessableEntityException {
  constructor(reason: string, message: string, status?: number) {
    super({ code: 'POD_LISTING_IMAGE_URL_FETCH_FAILED', message, details: { reason, status: status ?? null } });
  }
}

/**
 * **Thêm ảnh sản phẩm bằng URL** (Images & Video của Custom Listing / Listing Session).
 *
 * ```
 *   URL ─▶ fetchRemoteFile (SSRF: chỉ http/https cổng 80/443, chặn IP nội bộ NGAY lúc kết nối, đi redirect
 *          bằng tay và kiểm lại từng bước, deadline + trần byte thật)
 *       ─▶ chặn trang HTML (trang đăng nhập / chặn hotlink) ─▶ chữ ký file phải là JPEG/PNG/WEBP
 *       ─▶ Storage (`POD_TIKTOK` · `POD_LISTING_ASSET`) — ĐÚNG đường của ảnh tải từ máy
 * ```
 *
 * 🔴 Kết quả là một file Storage bình thường (`id` + `publicUrl`) ⇒ form giữ `fileId` như ảnh upload, payload
 * submit KHÔNG đổi, và publisher upload ảnh lên TikTok từ Storage — không bao giờ tự đi lấy URL người dùng nhập
 * (URL có thể hết hạn / đổi nội dung sau này).
 *
 * 🔴 Log chỉ ghi HOSTNAME — URL ảnh hay mang token ký (`?X-Amz-Signature=…`).
 */
@Injectable()
export class PodListingImageUrlService {
  private readonly logger = new Logger(PodListingImageUrlService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly mapper: StorageMapper,
  ) {}

  /**
   * Như `importImage`, nhưng URL đã tải thành công trước đây thì dùng lại file đã lưu: không gọi tới nguồn, nên URL đã hết
   * hạn vẫn dùng được, và mở lại nháp rồi nhập lại URL không sinh file mới. URL chưa từng tải vẫn đi đủ đường kiểm tra.
   */
  async importOrReuse(
    organizationId: string,
    actorUserId: string,
    rawUrl: string,
    fetchOptions: Partial<RemoteFetchOptions> = {},
  ): Promise<StorageFileDto> {
    try {
      assertFetchableUrl(rawUrl, fetchOptions.testNetwork?.ports);
    } catch (error) {
      if (!(error instanceof RemoteFetchError)) throw error;
      throw new PodListingImageUrlInvalidException(error.reason, error.message);
    }
    const sourceUrlHash = sourceUrlHashOf(rawUrl);
    const existing = await this.storage.findBySourceUrlHash(organizationId, sourceUrlHash);
    if (existing) {
      this.logger.log({
        module: 'pod-listing',
        operation: 'image-url.reuse',
        organizationId,
        host: hostOf(rawUrl),
        fileId: existing.id,
        msg: 'Dùng lại ảnh đã tải từ URL',
      });
      return this.mapper.toDto(existing);
    }
    try {
      return await this.importImage(organizationId, actorUserId, rawUrl, fetchOptions, sourceUrlHash);
    } catch (error) {
      // Hai yêu cầu cùng URL chạy song song: bên về sau bị UNIQUE chặn (object của nó đã được dọn) ⇒ dùng file của bên trước.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.storage.findBySourceUrlHash(organizationId, sourceUrlHash);
        if (winner) return this.mapper.toDto(winner);
      }
      throw error;
    }
  }

  async importImage(
    organizationId: string,
    actorUserId: string,
    rawUrl: string,
    fetchOptions: Partial<RemoteFetchOptions> = {},
    sourceUrlHash?: string,
  ): Promise<StorageFileDto> {
    const host = hostOf(rawUrl);
    let remote: RemoteFile;
    try {
      remote = await fetchRemoteFile(toDirectDownloadUrl(rawUrl), {
        maxBytes: POD_LISTING_IMAGE_URL_MAX_BYTES,
        timeoutMs: POD_LISTING_IMAGE_URL_TIMEOUT_MS,
        maxRedirects: POD_LISTING_IMAGE_URL_MAX_REDIRECTS,
        ...fetchOptions,
      });
    } catch (error) {
      if (!(error instanceof RemoteFetchError)) throw error;
      this.logger.warn({
        module: 'pod-listing',
        operation: 'image-url.fetch',
        organizationId,
        host,
        reason: error.reason,
        status: error.status ?? null,
        msg: 'Không lấy được ảnh từ URL',
      });
      if (URL_INVALID.includes(error.reason)) {
        throw new PodListingImageUrlInvalidException(error.reason, error.message);
      }
      throw new PodListingImageUrlFetchFailedException(error.reason, fetchFailureMessage(error), error.status);
    }

    if (remote.contentType === 'text/html' || remote.contentType === 'application/xhtml+xml') {
      throw new PodListingImageUrlFetchFailedException(
        'NOT_IMAGE',
        isGoogleDriveUrl(rawUrl)
          ? 'Google Drive không trả về file ảnh — file chưa được chia sẻ công khai, đã bị xoá, hoặc link không trỏ tới ' +
              'một file. Hãy bật chia sẻ "Bất kỳ ai có đường liên kết" và dùng link của file.'
          : 'URL trả về một TRANG WEB, không phải file ảnh — thường là trang đăng nhập hoặc trang chặn liên kết ' +
              'ngoài. Hãy dùng link trực tiếp tới file ảnh công khai.',
      );
    }
    const mimeType = detectImageMime(remote.buffer);
    const declaredOk =
      remote.contentType.startsWith('image/') || GENERIC_CONTENT_TYPES.includes(remote.contentType);
    if (!declaredOk || !mimeType) {
      throw new PodListingImageUrlFetchFailedException(
        'UNSUPPORTED_TYPE',
        `URL không trả về ảnh JPEG, PNG hoặc WEBP (máy chủ khai "${remote.contentType || 'không rõ'}").`,
      );
    }

    // Tên gốc chỉ để hiển thị; đuôi luôn theo định dạng THẬT để Storage đối chiếu mime ⇄ đuôi.
    const baseName = (remote.fileName ?? 'image').replace(/\.[A-Za-z0-9]{1,5}$/, '').slice(0, 200) || 'image';
    const stored = await this.storage.upload(
      {
        fieldname: 'files',
        originalname: `${baseName}.${IMAGE_MIME_EXTENSION[mimeType]}`,
        encoding: '7bit',
        mimetype: mimeType,
        size: remote.buffer.length,
        buffer: remote.buffer,
      } as Express.Multer.File,
      {
        organizationId,
        actorUserId,
        module: StorageModuleName.POD_TIKTOK,
        referenceType: StorageReferenceType.POD_LISTING_ASSET,
        referenceId: null,
        sourceUrlHash,
        folderSegments: this.storage.defaultFolderSegments(
          organizationId,
          StorageModuleName.POD_TIKTOK,
          StorageReferenceType.POD_LISTING_ASSET,
        ),
      },
    );

    this.logger.log({
      module: 'pod-listing',
      operation: 'image-url.import',
      organizationId,
      host,
      redirects: remote.redirects,
      sizeBytes: remote.buffer.length,
      mimeType,
      fileId: stored.id,
      msg: 'Đã thêm ảnh sản phẩm từ URL',
    });
    return this.mapper.toDto(stored);
  }
}

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

/** Câu lỗi người dùng đọc được — phân biệt hết hạn / cần đăng nhập / chặn hotlink / quá lớn / quá lâu. */
function fetchFailureMessage(error: RemoteFetchError): string {
  switch (error.reason) {
    case 'HTTP_STATUS':
      if (error.status === 401 || error.status === 403) {
        return `Máy chủ ảnh từ chối truy cập (HTTP ${error.status}) — link cần đăng nhập, đã hết hạn hoặc chặn tải từ nơi khác.`;
      }
      if (error.status === 404 || error.status === 410) {
        return `Không tìm thấy ảnh (HTTP ${error.status}) — link sai, đã bị xoá hoặc đã hết hạn.`;
      }
      return `Máy chủ ảnh trả lỗi HTTP ${error.status ?? '?'}.`;
    case 'TOO_LARGE':
      return `Ảnh lớn hơn ${POD_LISTING_IMAGE_URL_MAX_BYTES / 1024 / 1024} MB — TikTok không nhận.`;
    case 'TIMEOUT':
      return 'Máy chủ ảnh phản hồi quá lâu — thử lại hoặc dùng link khác.';
    case 'TOO_MANY_REDIRECTS':
      return 'Link chuyển hướng quá nhiều lần.';
    case 'EMPTY':
      return 'Máy chủ ảnh trả về nội dung rỗng.';
    default:
      return `Không tải được ảnh: ${error.message}`;
  }
}
