import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdatePodTiktokAccountLoginInfoDto } from './pod-tiktok-query.dto';
import { UpdatePodOrderDesignAmountDto } from './pod-order-query.dto';

function parse<T extends object>(cls: new () => T, body: Record<string, unknown>) {
  const dto = plainToInstance(cls, body, { enableImplicitConversion: true });
  return { dto, errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }) };
}

describe('UpdatePodTiktokAccountLoginInfoDto', () => {
  it('chuẩn hoá email (trim + chữ thường); email sai ⇒ lỗi', () => {
    expect(parse(UpdatePodTiktokAccountLoginInfoDto, { tiktokMail: '  Shop.US@Gmail.COM ' }).dto.tiktokMail).toBe(
      'shop.us@gmail.com',
    );
    expect(parse(UpdatePodTiktokAccountLoginInfoDto, { tiktokMail: 'not-an-email' }).errors).toHaveLength(1);
  });

  it('email rỗng ⇒ null (xoá)', () => {
    const { dto, errors } = parse(UpdatePodTiktokAccountLoginInfoDto, { tiktokMail: '   ' });
    expect(errors).toHaveLength(0);
    expect(dto.tiktokMail).toBeNull();
  });

  it('🔒 password / 2FA rỗng ⇒ undefined = GIỮ NGUYÊN (không vô tình xoá)', () => {
    const { dto, errors } = parse(UpdatePodTiktokAccountLoginInfoDto, { tiktokPassword: '', tiktokTwoFactorCode: '  ' });
    expect(errors).toHaveLength(0);
    expect(dto.tiktokPassword).toBeUndefined();
    expect(dto.tiktokTwoFactorCode).toBeUndefined();
  });

  it('password giữ nguyên khoảng trắng; 2FA bỏ khoảng trắng hai đầu; null = xoá', () => {
    const { dto } = parse(UpdatePodTiktokAccountLoginInfoDto, { tiktokPassword: ' p w ', tiktokTwoFactorCode: ' ABC ' });
    expect(dto.tiktokPassword).toBe(' p w ');
    expect(dto.tiktokTwoFactorCode).toBe('ABC');
    const cleared = parse(UpdatePodTiktokAccountLoginInfoDto, { tiktokPassword: null, tiktokTwoFactorCode: null });
    expect(cleared.errors).toHaveLength(0);
    expect(cleared.dto.tiktokPassword).toBeNull();
  });

  it('Ngày về tiền: YYYY-MM-DD hợp lệ; rỗng ⇒ null; sai dạng ⇒ lỗi', () => {
    expect(parse(UpdatePodTiktokAccountLoginInfoDto, { moneyReturnDate: '2026-11-05' }).errors).toHaveLength(0);
    expect(parse(UpdatePodTiktokAccountLoginInfoDto, { moneyReturnDate: '' }).dto.moneyReturnDate).toBeNull();
    expect(parse(UpdatePodTiktokAccountLoginInfoDto, { moneyReturnDate: '05/11/2026' }).errors).toHaveLength(1);
    expect(parse(UpdatePodTiktokAccountLoginInfoDto, { moneyReturnDate: '2026-11-05T00:00:00Z' }).errors).toHaveLength(1);
  });

  it('password quá 256 ký tự ⇒ lỗi; trường lạ ⇒ lỗi (forbidNonWhitelisted)', () => {
    expect(parse(UpdatePodTiktokAccountLoginInfoDto, { tiktokPassword: 'x'.repeat(257) }).errors).toHaveLength(1);
    expect(parse(UpdatePodTiktokAccountLoginInfoDto, { sellerId: 'x' }).errors).toHaveLength(1);
  });
});

describe('UpdatePodOrderDesignAmountDto', () => {
  it.each([[0], [2.5], ['3.75'], [1_000_000]])('hợp lệ: %p', (value) => {
    expect(parse(UpdatePodOrderDesignAmountDto, { designAmount: value }).errors).toHaveLength(0);
  });

  it.each([[-1], [1.234], [1_000_001], ['abc'], [undefined]])('không hợp lệ: %p', (value) => {
    expect(parse(UpdatePodOrderDesignAmountDto, { designAmount: value }).errors.length).toBeGreaterThan(0);
  });
});
