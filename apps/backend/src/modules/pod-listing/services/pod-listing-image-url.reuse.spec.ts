import { Prisma } from '@prisma/client';
import { fetchRemoteFile, RemoteFetchError } from '../../../common/http/safe-remote-fetch';
import {
  PodListingImageUrlFetchFailedException,
  PodListingImageUrlInvalidException,
  PodListingImageUrlService,
  sourceUrlHashOf,
} from './pod-listing-image-url.service';

jest.mock('../../../common/http/safe-remote-fetch', () => ({
  ...jest.requireActual<object>('../../../common/http/safe-remote-fetch'),
  fetchRemoteFile: jest.fn(),
}));
const fetchMock = fetchRemoteFile as jest.MockedFunction<typeof fetchRemoteFile>;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(64, 3)]);
const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const DRIVE_DOWNLOAD = `https://drive.google.com/uc?export=download&id=${DRIVE_ID}`;
const remote = (buffer: Buffer | string, contentType: string) => ({
  buffer: Buffer.from(buffer),
  contentType,
  fileName: 'a.png',
  finalUrl: 'https://x/a',
  redirects: 0,
});

function build(existing: { id: string } | null = null) {
  const storage = {
    findBySourceUrlHash: jest.fn().mockResolvedValue(existing),
    upload: jest.fn((file: Express.Multer.File) => Promise.resolve({ id: 'new-file', mimeType: file.mimetype })),
    defaultFolderSegments: jest.fn(() => ['pod_tiktok', 'org-1', 'pod_listing_asset']),
  };
  const mapper = { toDto: jest.fn((stored: { id: string }) => stored) };
  const service = new PodListingImageUrlService(storage as never, mapper as never);
  return { service, storage };
}

beforeEach(() => fetchMock.mockReset());

describe('sourceUrlHashOf — cùng luật so khớp với form', () => {
  const hash = sourceUrlHashOf;
  it('bỏ #fragment, host chữ thường', () => {
    expect(hash('https://CDN.example.com/a.jpg#zoom')).toBe(hash('https://cdn.example.com/a.jpg'));
  });
  it('query khác là URL khác', () => {
    expect(hash('https://cdn.example.com/a.jpg?x=1')).not.toBe(hash('https://cdn.example.com/a.jpg?x=2'));
  });
  it('mọi dạng link Drive của cùng file là một', () => {
    const expected = hash(DRIVE_DOWNLOAD);
    expect(hash(`https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`)).toBe(expected);
    expect(hash(`https://drive.google.com/open?id=${DRIVE_ID}`)).toBe(expected);
  });
});

describe('importOrReuse — dùng lại file đã lưu', () => {
  const URL_A = 'https://cdn.example.com/a.png';

  it('🔴 URL đã tải trước đây ⇒ trả file cũ, KHÔNG gọi nguồn, không tạo file mới', async () => {
    const { service, storage } = build({ id: 'stored-file' });
    const result = await service.importOrReuse('org-1', 'user-1', URL_A);
    expect(result).toEqual({ id: 'stored-file' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.findBySourceUrlHash).toHaveBeenCalledWith('org-1', sourceUrlHashOf(URL_A));
  });

  it('URL mới ⇒ tải, kiểm tra, lưu kèm khoá URL nguồn', async () => {
    fetchMock.mockResolvedValue(remote(PNG, 'image/png'));
    const { service, storage } = build();
    await service.importOrReuse('org-1', 'user-1', URL_A);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storage.upload.mock.calls[0]).toEqual([
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-1', sourceUrlHash: sourceUrlHashOf(URL_A) }),
    ]);
  });

  it('URL chưa từng tải thành công và đã hết hạn ⇒ vẫn báo lỗi, không tạo file', async () => {
    fetchMock.mockRejectedValue(new RemoteFetchError('HTTP_STATUS', 'HTTP 403', 403));
    const { service, storage } = build();
    await expect(service.importOrReuse('org-1', 'user-1', URL_A)).rejects.toBeInstanceOf(
      PodListingImageUrlFetchFailedException,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('URL sai dạng / nội bộ ⇒ 400, không tra cứu', async () => {
    const { service, storage } = build();
    await expect(service.importOrReuse('org-1', 'user-1', 'http://127.0.0.1/a.png')).rejects.toBeInstanceOf(
      PodListingImageUrlInvalidException,
    );
    await expect(service.importOrReuse('org-1', 'user-1', 'not a url')).rejects.toBeInstanceOf(
      PodListingImageUrlInvalidException,
    );
    expect(storage.findBySourceUrlHash).not.toHaveBeenCalled();
  });

  it('hai yêu cầu cùng URL song song: bên sau dính UNIQUE ⇒ dùng file của bên trước', async () => {
    fetchMock.mockResolvedValue(remote(PNG, 'image/png'));
    const { service, storage } = build();
    storage.upload.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    storage.findBySourceUrlHash.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner' });
    await expect(service.importOrReuse('org-1', 'user-1', URL_A)).resolves.toEqual({ id: 'winner' });
  });

  it('lỗi khác của Storage không bị nuốt', async () => {
    fetchMock.mockResolvedValue(remote(PNG, 'image/png'));
    const { service, storage } = build();
    storage.upload.mockRejectedValueOnce(new Error('R2 down'));
    await expect(service.importOrReuse('org-1', 'user-1', URL_A)).rejects.toThrow('R2 down');
  });
});

describe('importImage — nguồn Google Drive và URL thường', () => {
  const VIEW = `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=drive_link`;

  it('🔴 link chia sẻ Drive công khai ⇒ tải qua link tải của cùng file rồi lưu Storage', async () => {
    fetchMock.mockResolvedValue(remote(PNG, 'image/png'));
    const { service, storage } = build();
    await service.importImage('org-1', 'user-1', VIEW);
    expect(fetchMock.mock.calls[0][0]).toBe(DRIVE_DOWNLOAD);
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });

  it('🔴 Drive riêng tư / đã xoá (trả trang HTML) ⇒ 422 nói rõ cách sửa, KHÔNG tạo ảnh hỏng', async () => {
    fetchMock.mockResolvedValue(remote('<!doctype html><title>Sign in</title>', 'text/html'));
    const { service, storage } = build();
    await expect(service.importImage('org-1', 'user-1', VIEW)).rejects.toThrow(/Bất kỳ ai có đường liên kết/);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('link Drive không trỏ tới file (thư mục) ⇒ giữ nguyên URL, HTML ⇒ 422', async () => {
    const folder = 'https://drive.google.com/drive/folders/abc';
    fetchMock.mockResolvedValue(remote('<html></html>', 'text/html'));
    const { service, storage } = build();
    await expect(service.importImage('org-1', 'user-1', folder)).rejects.toBeInstanceOf(
      PodListingImageUrlFetchFailedException,
    );
    expect(fetchMock.mock.calls[0][0]).toBe(folder);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('Drive khai ảnh nhưng nội dung không phải ảnh ⇒ không lưu (tin chữ ký file, không tin khai báo/đuôi)', async () => {
    fetchMock.mockResolvedValue(remote('not an image', 'image/png'));
    const { service, storage } = build();
    await expect(service.importImage('org-1', 'user-1', VIEW)).rejects.toBeInstanceOf(
      PodListingImageUrlFetchFailedException,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('nguồn hết hạn / không còn (404) ⇒ 422', async () => {
    fetchMock.mockRejectedValue(new RemoteFetchError('HTTP_STATUS', 'HTTP 404', 404));
    const { service } = build();
    await expect(service.importImage('org-1', 'user-1', VIEW)).rejects.toBeInstanceOf(
      PodListingImageUrlFetchFailedException,
    );
  });

  it.each([
    ['JPG', 'https://cdn.example.com/a.jpg', JPEG, 'image/jpeg'],
    ['PNG', 'https://cdn.example.com/a.png', PNG, 'image/png'],
    ['WEBP', 'https://cdn.example.com/a.webp', WEBP, 'image/webp'],
  ])('URL %s thường ⇒ không bị đổi URL', async (_label, url, body, mime) => {
    fetchMock.mockResolvedValue(remote(body, mime));
    const { service, storage } = build();
    await service.importImage('org-1', 'user-1', url);
    expect(fetchMock.mock.calls[0][0]).toBe(url);
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });
});
