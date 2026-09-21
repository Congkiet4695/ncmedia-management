import { BadRequestException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * 🔴 Lỗi của tầng HTTP Express (body-parser) phải giữ đúng mã trạng thái.
 *
 * Batch edit 3.107 SKU gửi body ~121 KB > 100 KB mặc định của body-parser ⇒ nó ném lỗi
 * `http-errors` 413 TRƯỚC khi tới controller; Nest chuyển tiếp nguyên trạng (không phải
 * `HttpException`) và filter cũ biến nó thành `500 INTERNAL_ERROR "Internal server error"`.
 */
function invoke(exception: unknown) {
  const json = jest.fn<void, [Record<string, unknown>]>();
  const status = jest.fn<{ json: typeof json }, [number]>().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/api/v1/pod/flash-sales/x/items/batch', method: 'PATCH' }),
    }),
  };
  const logger = { error: jest.fn(), warn: jest.fn() };
  new AllExceptionsFilter(logger as never).catch(exception, host as never);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] ?? {}, logger };
}

describe('AllExceptionsFilter', () => {
  it('🔴 body quá lớn (413 của body-parser) ⇒ 413 PAYLOAD_TOO_LARGE, không phải 500 INTERNAL_ERROR', () => {
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      expose: true,
      type: 'entity.too.large',
    });

    const { status, body, logger } = invoke(error);

    expect(status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.message).toBe('request entity too large');
    // 4xx là warn, không phải error.
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('JSON hỏng (400 của body-parser, expose=false) ⇒ 400 với thông điệp an toàn', () => {
    const error = Object.assign(new Error('Unexpected token'), { status: 400, expose: false });

    const { status, body } = invoke(error);

    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.message).toBe('Request error');
  });

  it('HttpException của Nest vẫn giữ code nghiệp vụ', () => {
    const { status, body } = invoke(new BadRequestException({ code: 'VALIDATION_ERROR', message: 'sai' }));

    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('Error thường ⇒ 500 INTERNAL_ERROR kèm log stack', () => {
    const { status, body, logger } = invoke(new Error('boom'));

    expect(status).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(logger.error).toHaveBeenCalled();
  });

  it('`status` không hợp lệ trên Error không được coi là lỗi HTTP', () => {
    const { status } = invoke(Object.assign(new Error('x'), { status: 'weird' }));
    expect(status).toBe(500);
  });
});
