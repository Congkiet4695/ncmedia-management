import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import {
  FulfillmentProviderInactiveException,
  FulfillmentProviderMisconfiguredException,
} from '../../exceptions/fulfillment.exceptions';
import {
  MangoCredentialService,
  type MangoAccountCredentialRef,
} from './mango-credential.service';

/** Mã hoá giả lập — tiền tố `enc:` để phân biệt rõ "đã giải mã" với "chưa giải mã". */
const encryption = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ''),
} as unknown as TiktokEncryptionService;

function provider(over: Partial<MangoAccountCredentialRef> = {}): MangoAccountCredentialRef {
  return {
    id: 'acc-1',
    organizationId: 'org-1',
    name: 'Mango US',
    isActive: true,
    apiKeyEnc: 'enc:live-key-123456',
    baseUrlOverride: 'https://v3.mangoteeprints.com/api/public/v1',
    ...over,
  };
}

describe('MangoCredentialService', () => {
  const service = new MangoCredentialService(encryption);

  describe('buildContext', () => {
    it('trả API key đã giải mã và base URL của nhà cung cấp', () => {
      expect(service.buildContext(provider())).toEqual({
        apiKey: 'live-key-123456',
        baseUrl: 'https://v3.mangoteeprints.com/api/public/v1',
      });
    });

    it('chặn nhà cung cấp INACTIVE', () => {
      expect(() => service.buildContext(provider({ isActive: false }))).toThrow(
        FulfillmentProviderInactiveException,
      );
    });

    it('chặn khi thiếu Base URL', () => {
      expect(() => service.buildContext(provider({ baseUrlOverride: '   ' }))).toThrow(
        FulfillmentProviderMisconfiguredException,
      );
    });

    it('chặn khi thiếu API key', () => {
      expect(() => service.buildContext(provider({ apiKeyEnc: null }))).toThrow(
        FulfillmentProviderMisconfiguredException,
      );
    });

    it('chặn khi API key giải mã ra chuỗi rỗng', () => {
      // Bản ghi hỏng vẫn phải hỏng SỚM và rõ, thay vì gửi header rỗng rồi nhận 401.
      expect(() => service.buildContext(provider({ apiKeyEnc: 'enc:   ' }))).toThrow(
        FulfillmentProviderMisconfiguredException,
      );
    });

    it('kiểm trạng thái TRƯỚC khi chạm vào API key', () => {
      // Nhà cung cấp tắt thì không có lý do gì phải giải mã khoá.
      const spy = jest.spyOn(encryption, 'decrypt');
      spy.mockClear();

      expect(() =>
        service.buildContext(provider({ isActive: false, apiKeyEnc: 'enc:x' })),
      ).toThrow(FulfillmentProviderInactiveException);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('không có nguồn key nào ngoài database', () => {
    it('KHÔNG đọc biến môi trường — đặt MANGO_API_KEY cũng không cứu được bản ghi thiếu key', () => {
      // Chốt chặn hồi quy cho yêu cầu: mỗi TikTok Account dùng đúng khoá của nhà cung cấp
      // được gán, không tồn tại khoá "toàn cục" có thể bị dùng nhầm cho tổ chức khác.
      process.env.MANGO_API_KEY = 'key-tu-bien-moi-truong';
      try {
        expect(() => service.buildContext(provider({ apiKeyEnc: null }))).toThrow(
          FulfillmentProviderMisconfiguredException,
        );
      } finally {
        delete process.env.MANGO_API_KEY;
      }
    });
  });

  describe('thông báo lỗi', () => {
    it('nêu đúng tên nhà cung cấp và trường còn thiếu', () => {
      try {
        service.buildContext(provider({ name: 'Mango EU', apiKeyEnc: null }));
        fail('phải ném lỗi');
      } catch (error) {
        const body = (error as FulfillmentProviderMisconfiguredException).getResponse() as {
          code: string;
          message: string;
        };
        expect(body.code).toBe('FULFILLMENT_PROVIDER_MISCONFIGURED');
        expect(body.message).toContain('Mango EU');
        expect(body.message).toContain('API Key');
      }
    });
  });
});
