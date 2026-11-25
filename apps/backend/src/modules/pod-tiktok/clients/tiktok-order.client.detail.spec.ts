import { TiktokApiClient } from './tiktok-api.client';
import { TiktokOrderClient } from './tiktok-order.client';

/** Get Order Detail (`GET /order/202309/orders`) — dùng cho "Sync Orders" theo lựa chọn. */
describe('TiktokOrderClient.getOrderDetails', () => {
  let api: { callSigned: jest.Mock };
  let client: TiktokOrderClient;

  beforeEach(() => {
    api = {
      callSigned: jest.fn().mockResolvedValue({ data: { orders: [{ id: 'A' }] }, requestId: 'r1' }),
    };
    client = new TiktokOrderClient(api as unknown as TiktokApiClient);
  });

  it('GET đúng path, shop_cipher + ids nối bằng dấu phẩy, không body', async () => {
    const result = await client.getOrderDetails({
      shopCipher: 'C',
      accessToken: 'T',
      ids: ['A', 'B'],
    });

    expect(api.callSigned).toHaveBeenCalledWith({
      path: '/order/202309/orders',
      method: 'GET',
      query: { shop_cipher: 'C', ids: 'A,B' },
      accessToken: 'T',
      endpointLabel: 'GET_ORDER_DETAIL',
    });
    expect(result).toEqual({ orders: [{ id: 'A' }], requestId: 'r1' });
  });

  it('🔴 quá 50 ID ⇒ ném lỗi TRƯỚC khi gọi TikTok', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => String(i));
    await expect(
      client.getOrderDetails({ shopCipher: 'C', accessToken: 'T', ids }),
    ).rejects.toThrow();
    expect(api.callSigned).not.toHaveBeenCalled();
  });

  it('rỗng ⇒ không gọi TikTok', async () => {
    expect(await client.getOrderDetails({ shopCipher: 'C', accessToken: 'T', ids: [] })).toEqual({
      orders: [],
    });
    expect(api.callSigned).not.toHaveBeenCalled();
  });
});
