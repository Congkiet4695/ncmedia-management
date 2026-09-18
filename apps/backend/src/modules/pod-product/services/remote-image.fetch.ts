import {
  POD_IMAGE_FETCH_MAX_BYTES,
  POD_IMAGE_FETCH_TIMEOUT_MS,
  POD_PRIVATE_HOST_PATTERN,
} from '../../pod-listing/constants/pod-listing.constants';

/** Ảnh đã tải về bộ nhớ — hình dạng mà Upload Product Image cần. */
export interface FetchedImage {
  buffer: Buffer;
  fileName: string;
  contentType: string;
}

/**
 * Tải ảnh từ URL ngoài (ảnh trong file import, ảnh của Description Template, ảnh Storage qua
 * URL công khai…).
 *
 * 🔴 URL do người dùng nhập mà server tự đi gọi ⇒ **SSRF**. Chỉ cho http/https và chặn mọi
 * địa chỉ nội bộ: không có hàng rào này thì một dòng Excel trỏ tới
 * `http://169.254.169.254/...` là đủ để đọc metadata của máy chủ.
 *
 * Trước đây nằm riêng trong `PodListingPublisherService`; tách ra để ảnh MÔ TẢ (đi qua
 * `PodDescriptionImageService`, module Product) dùng chung đúng một hàng rào — hai bản là hai
 * bản sẽ lệch nhau ở lần vá bảo mật đầu tiên.
 */
export async function fetchRemoteImage(url: string, label: string): Promise<FetchedImage> {
  const target = assertPublicHttpUrl(url, label);

  const response = await fetch(target, {
    redirect: 'follow',
    signal: AbortSignal.timeout(POD_IMAGE_FETCH_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new Error(
      `Không tải được ảnh ${label} (${target.hostname}): ${
        error instanceof Error ? error.message : 'lỗi mạng'
      }`,
    );
  });

  if (!response.ok) {
    throw new Error(`Không tải được ảnh ${label}: máy chủ trả về ${response.status}`);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`URL ảnh ${label} trả về "${contentType || 'không rõ'}", không phải ảnh.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > POD_IMAGE_FETCH_MAX_BYTES) {
    throw new Error(`Ảnh ${label} nặng hơn giới hạn ${POD_IMAGE_FETCH_MAX_BYTES} byte.`);
  }

  const fileName = decodeURIComponent(target.pathname.split('/').pop() || 'image') || 'image';
  return { buffer, fileName, contentType };
}

/** Chỉ chấp nhận http/https trỏ ra ngoài — chặn localhost và dải IP nội bộ. */
export function assertPublicHttpUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`URL ảnh ${label} không hợp lệ: "${raw}"`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`URL ảnh ${label} phải dùng http/https.`);
  }
  if (POD_PRIVATE_HOST_PATTERN.test(url.hostname)) {
    throw new Error(`URL ảnh ${label} trỏ vào địa chỉ nội bộ — không được phép.`);
  }
  return url;
}
