import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import { PodTiktokShopContextService } from '../../pod-tiktok/services/pod-tiktok-shop-context.service';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { TiktokErrorClass } from '../../pod-tiktok/constants/tiktok-error-code.constants';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import {
  PodAccessScopeService,
  PodShopForbiddenException,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { TiktokFulfillmentApiService } from '../../tiktok-sdk/tiktok-fulfillment-api.service';
import { PrismaService } from '../../../database/prisma.service';
import { MangoOrderMapper } from '../mango/mappers/mango-order.mapper';
import { mappingKeyOf } from '../shared/mapping-match';
import { FulfillmentReadinessService, READINESS_CODES } from './fulfillment-readiness.service';
import {
  FulfillmentShippingLabelService,
  ShippingLabelBusyException,
  ShippingLabelUnavailableException,
} from './fulfillment-shipping-label.service';

/**
 * **Nhãn vận chuyển TikTok** — bộ luật thay cho "địa chỉ bị che ⇒ cấm gửi".
 *
 * ```
 *   địa chỉ đọc được                        → gửi bình thường, KHÔNG đòi nhãn
 *   địa chỉ không đọc được + chưa có nhãn    → chặn, mã TIKTOK_SHIPPING_LABEL_REQUIRED
 *   địa chỉ không đọc được + đã có nhãn      → GỬI ĐƯỢC (địa chỉ thật nằm trên nhãn)
 *   bấm lấy nhãn nhiều lần                   → KHÔNG bao giờ tạo gói thứ hai
 * ```
 */

const RECIPIENT = {
  first_name: 'John',
  last_name: 'Doe',
  phone_number: '5551234567',
  address_line1: '123 Main St',
  postal_code: '33602',
  region_code: 'US',
  district_info: [
    { address_level: 'L1', address_name: 'Florida' },
    { address_level: 'L2', address_name: 'Tampa' },
  ],
};

/** Địa chỉ TikTok đã che sạch phần định danh — không còn gì để giao hàng. */
const REDACTED_RECIPIENT = {
  first_name: '',
  last_name: '',
  phone_number: '',
  address_line1: '',
  postal_code: '',
  region_code: 'US',
  district_info: [],
};

function order(over: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    shopId: 'shop-1',
    tiktokOrderId: '577582251551724199',
    status: 'AWAITING_SHIPMENT',
    recipientEnc: 'enc',
    recipientMasked: false,
    recipientRegionCode: 'US',
    recipientPostalCode: '33602',
    shippingLabelUrl: null,
    shippingLabelSource: null,
    shippingLabelPackageId: null,
    shippingLabelTrackingNumber: null,
    shippingLabelAt: null,
    packages: [],
    items: [
      {
        id: 'item-1',
        skuId: 'SKU-TT-1',
        sellerSku: 'SELLER-1',
        productId: 'PROD-1',
        productName: 'Tee',
      },
    ],
    ...over,
  };
}

function mapping(over: Record<string, unknown> = {}) {
  return {
    id: 'map-1',
    isActive: true,
    accountId: 'acc-1',
    tiktokProductId: 'PROD-1',
    sellerSku: 'SELLER-1',
    tiktokSkuId: 'SKU-TT-1',
    providerSku: 'MANGO-1',
    baseCost: null,
    productionConfig: null,
    productionLine: null,
    placementMap: null,
    ...over,
  };
}

const designs = () =>
  new Map([
    [
      mappingKeyOf('PROD-1', 'SELLER-1') as string,
      [{ placement: 'FRONT', storageFile: { publicUrl: 'https://cdn.example.com/a.png' } }],
    ],
  ]) as never;

/** Readiness với địa chỉ giải mã được (mặc định) hoặc đã bị che sạch. */
function buildReadiness(recipient: unknown = RECIPIENT): FulfillmentReadinessService {
  const encryption = {
    decrypt: jest.fn(() => JSON.stringify(recipient)),
  } as unknown as TiktokEncryptionService;
  return new FulfillmentReadinessService(encryption, new MangoOrderMapper());
}

// ---------------------------------------------------------------------------
// Test 1–4: điều kiện gửi
// ---------------------------------------------------------------------------

describe('Điều kiện gửi khi địa chỉ bị che', () => {
  it('Test 1 — có địa chỉ, không có nhãn ⇒ gửi được (không đòi nhãn)', () => {
    const result = buildReadiness().check(order() as never, [mapping()] as never, designs());

    expect(result.ready).toBe(true);
    expect(result.shippingMode).toBe('ADDRESS');
    expect(result.shippingLabel).toBeNull();
  });

  it('Test 2 — địa chỉ bị che, KHÔNG có nhãn ⇒ chặn kèm mã TIKTOK_SHIPPING_LABEL_REQUIRED', () => {
    const result = buildReadiness(REDACTED_RECIPIENT).check(
      order({ recipientMasked: true }) as never,
      [mapping()] as never,
      designs(),
    );

    expect(result.ready).toBe(false);
    const issue = result.issues.find(
      (entry) => entry.code === READINESS_CODES.TIKTOK_SHIPPING_LABEL_REQUIRED,
    );
    expect(issue).toBeDefined();
    // Thông điệp phải nói ĐÚNG việc cần làm, không phải "không thể gửi".
    expect(issue?.message).toContain('nhãn');
  });

  it('Test 3 — địa chỉ bị che + đã có nhãn TikTok ⇒ GỬI ĐƯỢC', () => {
    const result = buildReadiness(REDACTED_RECIPIENT).check(
      order({
        recipientMasked: true,
        shippingLabelUrl: 'https://label.tiktok.test/a.pdf',
        shippingLabelSource: 'TIKTOK',
        shippingLabelPackageId: 'PKG-1',
        shippingLabelTrackingNumber: 'TRK-1',
        shippingLabelAt: new Date('2026-09-24T00:00:00.000Z'),
      }) as never,
      [mapping()] as never,
      designs(),
    );

    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.shippingMode).toBe('LABEL');
    expect(result.shippingLabel).toMatchObject({
      source: 'TIKTOK',
      packageId: 'PKG-1',
      trackingNumber: 'TRK-1',
    });
    // 🔴 KHÔNG bịa thông tin người nhận: phần TikTok đã che đi kèm dấu hiệu đã che, phần còn
    // đọc được (quốc gia, mã bưu chính) vẫn là giá trị thật.
    expect(result.address?.first_name).toBe('***');
    expect(result.address?.address_line_1).toBe('***');
    expect(result.address?.country).toBe('US');
    expect(result.address?.zip).toBe('33602');
  });

  it('Test 4 — nhãn người vận hành tự dán (đã lưu DB) cũng đủ điều kiện', () => {
    const result = buildReadiness(REDACTED_RECIPIENT).check(
      order({
        recipientMasked: true,
        shippingLabelUrl: 'https://seller-us.tiktok.com/easesafe/label.pdf',
        shippingLabelSource: 'MANUAL',
      }) as never,
      [mapping()] as never,
      designs(),
    );

    expect(result.ready).toBe(true);
    expect(result.shippingLabel?.source).toBe('MANUAL');
  });

  it('🔴 nhãn KHÔNG che được các lý do khác (thiếu design vẫn chặn)', () => {
    const result = buildReadiness(REDACTED_RECIPIENT).check(
      order({
        recipientMasked: true,
        shippingLabelUrl: 'https://label.tiktok.test/a.pdf',
        shippingLabelSource: 'TIKTOK',
      }) as never,
      [mapping()] as never,
      new Map() as never,
    );

    expect(result.ready).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain(READINESS_CODES.DESIGN_MISSING);
  });
});

// ---------------------------------------------------------------------------
// Test 5–9: lấy nhãn từ TikTok
// ---------------------------------------------------------------------------

const ALL_SHOPS: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };
const OTHER_SHOP_SELLER: PodAccessScope = { allShops: false, accountIds: ['acc-2'], shopIds: ['shop-2'] };
const OWN_SHOP_SELLER: PodAccessScope = { allShops: false, accountIds: ['acc-1'], shopIds: ['shop-1'] };

interface LabelHarness {
  service: FulfillmentShippingLabelService;
  tiktok: Record<string, jest.Mock>;
  podOrderUpdate: jest.Mock;
  packageUpsert: jest.Mock;
}

function buildLabelService(
  orderOverrides: Record<string, unknown> = {},
  options: { lockBusy?: boolean; repoError?: Error } = {},
): LabelHarness {
  const podOrderUpdate = jest.fn().mockResolvedValue({});
  const packageUpsert = jest.fn().mockResolvedValue({});

  const prisma = {
    podOrder: { update: podOrderUpdate },
    $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
      callback({ podOrder: { update: podOrderUpdate }, podOrderPackage: { upsert: packageUpsert } }),
    ),
  } as unknown as PrismaService;

  const podOrderRepo = {
    findById: options.repoError
      ? jest.fn().mockRejectedValue(options.repoError)
      : jest.fn().mockResolvedValue(order(orderOverrides)),
  } as unknown as PodOrderRepository;

  const shopContext = {
    resolve: jest.fn().mockResolvedValue({
      accessToken: 'token',
      shopCipher: 'cipher',
      shopId: 'shop-1',
      organizationId: 'org-1',
    }),
  } as unknown as PodTiktokShopContextService;

  const tiktok = {
    queryShippingServices: jest.fn().mockResolvedValue({
      data: {
        shippingServices: [
          { id: 'SVC-1', name: 'USPS Ground', isDefault: false },
          { id: 'SVC-2', name: 'USPS Priority', isDefault: true },
        ],
      },
      requestId: 'req-1',
    }),
    createPackage: jest.fn().mockResolvedValue({
      data: {
        packageId: 'PKG-NEW',
        shippingServiceInfo: { id: 'SVC-2', name: 'USPS Priority' },
      },
      requestId: 'req-2',
    }),
    getShippingDocument: jest.fn().mockResolvedValue({
      data: { docUrl: 'https://label.tiktok.test/PKG.pdf', trackingNumber: 'TRK-9' },
      requestId: 'req-3',
    }),
    getPackage: jest.fn(),
    // Mặc định: TikTok Shipping, đơn CHƯA có gói nào trên TikTok.
    getOrderFulfillmentInfo: jest.fn().mockResolvedValue({
      data: { found: true, status: 'AWAITING_SHIPMENT', shippingType: 'TIKTOK', packageIds: [] },
      requestId: 'req-0',
    }),
  };

  const lock = {
    withLock: jest.fn(<T,>(_key: string, _ttl: number, task: () => Promise<T>) =>
      options.lockBusy ? Promise.resolve(null) : task(),
    ),
  } as unknown as DistributedLockService;

  const service = new FulfillmentShippingLabelService(
    prisma,
    podOrderRepo,
    shopContext,
    tiktok as unknown as TiktokFulfillmentApiService,
    lock,
    new PodAccessScopeService({} as never),
  );

  // Không chờ thật khi hỏi lại tài liệu của gói vừa tạo.
  jest
    .spyOn(service as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
    .mockResolvedValue(undefined);

  return { service, tiktok, podOrderUpdate, packageUpsert };
}

describe('FulfillmentShippingLabelService.fetchFromTiktok', () => {
  it('Test 5 — chưa có gói ⇒ hỏi dịch vụ → tạo gói → lấy nhãn → LƯU đủ nhãn/gói/tracking', async () => {
    const { service, tiktok, podOrderUpdate, packageUpsert } = buildLabelService();

    const label = await service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS);

    expect(tiktok.queryShippingServices).toHaveBeenCalledTimes(1);
    expect(tiktok.createPackage).toHaveBeenCalledTimes(1);
    // Dịch vụ lấy từ phản hồi TikTok, ưu tiên cái được đánh dấu mặc định — không viết cứng.
    expect((tiktok.createPackage.mock.calls[0] as unknown[])[1]).toMatchObject({
      orderId: '577582251551724199',
      shippingServiceId: 'SVC-2',
    });

    expect(label).toMatchObject({
      labelUrl: 'https://label.tiktok.test/PKG.pdf',
      source: 'TIKTOK',
      packageId: 'PKG-NEW',
      trackingNumber: 'TRK-9',
      reusedPackage: false,
    });

    // Ghi xuống database: bản ghi gói + nhãn hiệu lực của đơn.
    expect(packageUpsert).toHaveBeenCalledTimes(1);
    const orderData = (podOrderUpdate.mock.calls.at(-1) as unknown[])[0] as {
      data: Record<string, unknown>;
    };
    expect(orderData.data).toMatchObject({
      shippingLabelUrl: 'https://label.tiktok.test/PKG.pdf',
      shippingLabelSource: 'TIKTOK',
      shippingLabelPackageId: 'PKG-NEW',
      shippingLabelTrackingNumber: 'TRK-9',
    });
  });

  it('Test 6 — bấm lần hai (đơn đã có nhãn + gói) ⇒ KHÔNG tạo gói mới', async () => {
    const { service, tiktok } = buildLabelService({
      shippingLabelPackageId: 'PKG-CU',
      shippingLabelUrl: 'https://label.tiktok.test/cu.pdf',
      shippingLabelSource: 'TIKTOK',
    });

    const label = await service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS);

    expect(tiktok.createPackage).not.toHaveBeenCalled();
    expect(tiktok.queryShippingServices).not.toHaveBeenCalled();
    expect(tiktok.getShippingDocument).toHaveBeenCalledWith(expect.anything(), 'PKG-CU');
    expect(label.reusedPackage).toBe(true);
  });

  it('Test 8 — đơn đã có gói ĐỒNG BỘ TỪ TIKTOK ⇒ dùng lại gói đó, không tạo gói mới', async () => {
    const { service, tiktok } = buildLabelService({
      packages: [{ tiktokPackageId: 'PKG-SYNC', shippingServiceName: null }],
    });

    const label = await service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS);

    expect(tiktok.createPackage).not.toHaveBeenCalled();
    expect(label.packageId).toBe('PKG-SYNC');
    expect(label.reusedPackage).toBe(true);
  });

  it('Test 6b — hai người bấm cùng lúc: lượt thứ hai bị khoá chặn, không tạo gói', async () => {
    const { service, tiktok } = buildLabelService({}, { lockBusy: true });

    await expect(service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)).rejects.toBeInstanceOf(
      ShippingLabelBusyException,
    );
    expect(tiktok.createPackage).not.toHaveBeenCalled();
  });

  it('Test 7 — TikTok trả lỗi ⇒ thông điệp có ý nghĩa, KHÔNG ghi gì xuống database', async () => {
    const { service, tiktok, podOrderUpdate, packageUpsert } = buildLabelService();
    tiktok.queryShippingServices.mockRejectedValueOnce(
      new TiktokClientError(
        TiktokErrorClass.BUSINESS,
        12_345_678,
        'Order is not eligible for TikTok Shipping',
        200,
        'req-err',
        'FULFILLMENT_SHIPPING_SERVICES',
      ),
    );

    const error = await service
      .fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ShippingLabelUnavailableException);
    // Nguyên văn lý do của TikTok được giữ lại — không thay bằng "địa chỉ bị che".
    expect((error as ShippingLabelUnavailableException).message).toContain(
      'Order is not eligible for TikTok Shipping',
    );
    expect(podOrderUpdate).not.toHaveBeenCalled();
    expect(packageUpsert).not.toHaveBeenCalled();
  });

  it('thiếu quyền/uỷ quyền hết hạn ⇒ nói rõ phải kết nối lại TikTok (không nuốt lỗi)', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.queryShippingServices.mockRejectedValueOnce(
      new TiktokClientError(
        TiktokErrorClass.AUTH,
        105005,
        'Access denied',
        200,
        'req-auth',
        'FULFILLMENT_SHIPPING_SERVICES',
      ),
    );

    await expect(service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)).rejects.toMatchObject({
      response: { code: 'TIKTOK_SCOPE_MISSING' },
    });
  });

  it('TikTok không có dịch vụ vận chuyển nào ⇒ báo đúng lý do, không tạo gói', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.queryShippingServices.mockResolvedValueOnce({ data: { shippingServices: [] } });

    await expect(service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)).rejects.toMatchObject({
      response: { code: 'TIKTOK_NO_ELIGIBLE_SHIPPING_SERVICE' },
    });
    expect(tiktok.createPackage).not.toHaveBeenCalled();
  });

  it('🔴 retry sau timeout: TikTok ĐÃ có gói (database chưa biết) ⇒ dùng lại gói đó, KHÔNG tạo gói thứ hai', async () => {
    const { service, tiktok, podOrderUpdate } = buildLabelService();
    tiktok.getOrderFulfillmentInfo.mockResolvedValueOnce({
      data: { found: true, status: 'AWAITING_COLLECTION', shippingType: 'TIKTOK', packageIds: ['PKG-FROM-TIKTOK'] },
      requestId: 'req-0',
    });

    const label = await service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS);

    expect(tiktok.createPackage).not.toHaveBeenCalled();
    expect(tiktok.queryShippingServices).not.toHaveBeenCalled();
    expect(tiktok.getShippingDocument).toHaveBeenCalledWith(expect.anything(), 'PKG-FROM-TIKTOK');
    expect(label).toMatchObject({ packageId: 'PKG-FROM-TIKTOK', reusedPackage: true });
    expect(podOrderUpdate).toHaveBeenCalled();
  });

  it('đơn KHÔNG thuộc TikTok Shipping (lưu trong đơn) ⇒ báo rõ, KHÔNG gọi TikTok', async () => {
    const { service, tiktok } = buildLabelService({ shippingType: 'SELLER' });

    await expect(service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)).rejects.toMatchObject({
      response: { code: 'TIKTOK_LABEL_NOT_TIKTOK_SHIPPING' },
    });
    expect(tiktok.getOrderFulfillmentInfo).not.toHaveBeenCalled();
    expect(tiktok.createPackage).not.toHaveBeenCalled();
  });

  it('TikTok báo đơn là SELLER shipping (dữ liệu đơn cũ) ⇒ báo rõ, KHÔNG tạo gói', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.getOrderFulfillmentInfo.mockResolvedValueOnce({
      data: { found: true, status: 'AWAITING_SHIPMENT', shippingType: 'SELLER', packageIds: [] },
    });

    await expect(service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)).rejects.toMatchObject({
      response: { code: 'TIKTOK_LABEL_NOT_TIKTOK_SHIPPING' },
    });
    expect(tiktok.queryShippingServices).not.toHaveBeenCalled();
    expect(tiktok.createPackage).not.toHaveBeenCalled();
  });

  it('gói vừa tạo chưa có file ⇒ hỏi lại tài liệu (không tạo gói mới) và lấy được nhãn', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.getShippingDocument
      .mockResolvedValueOnce({ data: {}, requestId: 'req-3a' })
      .mockResolvedValueOnce({ data: { docUrl: 'https://label.tiktok.test/late.pdf' }, requestId: 'req-3b' });

    const label = await service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS);

    expect(tiktok.createPackage).toHaveBeenCalledTimes(1);
    expect(tiktok.getShippingDocument).toHaveBeenCalledTimes(2);
    expect(label.labelUrl).toBe('https://label.tiktok.test/late.pdf');
  });

  it('tài liệu vẫn chưa có sau các lần hỏi ⇒ TIKTOK_SHIPPING_DOCUMENT_UNAVAILABLE kèm request id', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.getShippingDocument.mockResolvedValue({ data: {}, requestId: 'req-empty' });

    const error = (await service
      .fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)
      .catch((caught: unknown) => caught)) as ShippingLabelUnavailableException;

    expect(error.getResponse()).toMatchObject({
      code: 'TIKTOK_SHIPPING_DOCUMENT_UNAVAILABLE',
      details: { provider: 'TIKTOK', operation: 'SHIPPING_DOCUMENT', requestId: 'req-empty' },
    });
    expect(tiktok.createPackage).toHaveBeenCalledTimes(1);
  });

  it('TikTok timeout / 5xx ⇒ TIKTOK_UNREACHABLE (bấm lại an toàn), kèm bước lỗi + mã + request id', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.createPackage.mockRejectedValueOnce(
      new TiktokClientError(TiktokErrorClass.NETWORK, -1, 'socket hang up', 0, 'req-net', 'FULFILLMENT_CREATE_PACKAGE'),
    );

    const error = (await service
      .fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)
      .catch((caught: unknown) => caught)) as ShippingLabelUnavailableException;

    expect(error.getResponse()).toMatchObject({
      code: 'TIKTOK_UNREACHABLE',
      details: { provider: 'TIKTOK', operation: 'CREATE_PACKAGE', providerCode: '-1', requestId: 'req-net' },
    });
  });

  it('lỗi nghiệp vụ TikTok ⇒ giữ nguyên thông điệp + chi tiết an toàn (không token, không URL)', async () => {
    const { service, tiktok } = buildLabelService({ packages: [{ tiktokPackageId: 'PKG-OLD' }] });
    tiktok.getShippingDocument.mockRejectedValueOnce(
      new TiktokClientError(
        TiktokErrorClass.BUSINESS,
        21042102,
        "Documents couldn't be printed after the package has been pickup.",
        200,
        'req-biz',
        'FULFILLMENT_SHIPPING_DOCUMENT',
      ),
    );

    const error = (await service
      .fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)
      .catch((caught: unknown) => caught)) as ShippingLabelUnavailableException;
    const body = error.getResponse() as Record<string, unknown>;

    expect(body).toMatchObject({
      code: 'TIKTOK_SHIPPING_LABEL_UNAVAILABLE',
      details: { operation: 'SHIPPING_DOCUMENT', providerCode: '21042102', requestId: 'req-biz' },
    });
    expect(String(body.message)).toContain("couldn't be printed");
    expect(JSON.stringify(body)).not.toContain('token');
  });

  // -------------------------------------------------------------------------
  // Dịch vụ vận chuyển: không lấy phần tử đầu tiên vô điều kiện
  // -------------------------------------------------------------------------

  const TWO_SERVICES_NO_DEFAULT = {
    data: {
      shippingServices: [
        { id: 'SVC-A', name: 'USPS Ground Advantage', shippingProviderName: 'USPS', isDefault: false },
        { id: 'SVC-B', name: 'UPS Ground', shippingProviderName: 'UPS', isDefault: false },
      ],
    },
    requestId: 'req-svc',
  };

  it('TikTok trả MỘT dịch vụ (không đánh dấu mặc định) ⇒ dùng đúng dịch vụ đó', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.queryShippingServices.mockResolvedValueOnce({
      data: { shippingServices: [{ id: 'SVC-ONLY', name: 'USPS', isDefault: false }] },
    });

    await service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS);

    expect((tiktok.createPackage.mock.calls[0] as unknown[])[1]).toMatchObject({ shippingServiceId: 'SVC-ONLY' });
  });

  it('🔴 nhiều dịch vụ, KHÔNG có mặc định ⇒ dừng, trả danh sách để chọn, KHÔNG tạo gói', async () => {
    const { service, tiktok, podOrderUpdate } = buildLabelService();
    tiktok.queryShippingServices.mockResolvedValueOnce(TWO_SERVICES_NO_DEFAULT);

    const error = (await service
      .fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)
      .catch((caught: unknown) => caught)) as ShippingLabelUnavailableException;

    expect(error.getResponse()).toMatchObject({
      code: 'TIKTOK_SHIPPING_SERVICE_SELECTION_REQUIRED',
      details: {
        operation: 'SHIPPING_SERVICES',
        shippingServices: [
          { id: 'SVC-A', name: 'USPS Ground Advantage', shippingProviderName: 'USPS' },
          { id: 'SVC-B', name: 'UPS Ground', shippingProviderName: 'UPS' },
        ],
      },
    });
    expect(tiktok.createPackage).not.toHaveBeenCalled();
    expect(podOrderUpdate).not.toHaveBeenCalled();
  });

  it('hai dịch vụ cùng đánh dấu mặc định ⇒ vẫn phải chọn (không đoán)', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.queryShippingServices.mockResolvedValueOnce({
      data: {
        shippingServices: [
          { id: 'SVC-A', name: 'A', isDefault: true },
          { id: 'SVC-B', name: 'B', isDefault: true },
        ],
      },
    });

    await expect(service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)).rejects.toMatchObject({
      response: { code: 'TIKTOK_SHIPPING_SERVICE_SELECTION_REQUIRED' },
    });
    expect(tiktok.createPackage).not.toHaveBeenCalled();
  });

  it('người vận hành chọn dịch vụ ⇒ tạo gói với ĐÚNG dịch vụ đó', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.queryShippingServices.mockResolvedValueOnce(TWO_SERVICES_NO_DEFAULT);

    await service.fetchFromTiktok('org-1', 'user-1', 'order-1', { shippingServiceId: 'SVC-B' }, ALL_SHOPS);

    expect((tiktok.createPackage.mock.calls[0] as unknown[])[1]).toMatchObject({ shippingServiceId: 'SVC-B' });
  });

  it('dịch vụ đã chọn KHÔNG nằm trong danh sách TikTok ⇒ TIKTOK_SHIPPING_SERVICE_INVALID, không tạo gói', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.queryShippingServices.mockResolvedValueOnce(TWO_SERVICES_NO_DEFAULT);

    await expect(
      service.fetchFromTiktok('org-1', 'user-1', 'order-1', { shippingServiceId: 'SVC-HARDCODED' }, ALL_SHOPS),
    ).rejects.toMatchObject({ response: { code: 'TIKTOK_SHIPPING_SERVICE_INVALID' } });
    expect(tiktok.createPackage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Đơn không hợp lệ
  // -------------------------------------------------------------------------

  it('TikTok không trả về đơn ⇒ TIKTOK_ORDER_NOT_FOUND, không hỏi dịch vụ, không tạo gói', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.getOrderFulfillmentInfo.mockResolvedValueOnce({ data: { found: false, packageIds: [] } });

    await expect(service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)).rejects.toMatchObject({
      response: { code: 'TIKTOK_ORDER_NOT_FOUND' },
    });
    expect(tiktok.queryShippingServices).not.toHaveBeenCalled();
    expect(tiktok.createPackage).not.toHaveBeenCalled();
  });

  it('đơn đã huỷ trên TikTok ⇒ TIKTOK_ORDER_NOT_PACKABLE, không tạo gói', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.getOrderFulfillmentInfo.mockResolvedValueOnce({
      data: { found: true, status: 'CANCELLED', shippingType: 'TIKTOK', packageIds: [] },
    });

    await expect(service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)).rejects.toMatchObject({
      response: { code: 'TIKTOK_ORDER_NOT_PACKABLE' },
    });
    expect(tiktok.createPackage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Tạo gói: idempotency khi hỏng đường truyền
  // -------------------------------------------------------------------------

  const networkError = () =>
    new TiktokClientError(TiktokErrorClass.NETWORK, 0, 'TikTok không phản hồi trong 20 giây', 0, undefined, 'FULFILLMENT_CREATE_PACKAGE');

  it('🔴 CASE 5 — tạo gói TIMEOUT nhưng TikTok ĐÃ tạo ⇒ đối soát thấy gói, dùng nó, KHÔNG gửi lệnh tạo lần 2', async () => {
    const { service, tiktok, podOrderUpdate } = buildLabelService();
    tiktok.createPackage.mockRejectedValueOnce(networkError());
    tiktok.getOrderFulfillmentInfo
      .mockResolvedValueOnce({ data: { found: true, status: 'AWAITING_SHIPMENT', shippingType: 'TIKTOK', packageIds: [] } })
      .mockResolvedValueOnce({ data: { found: true, status: 'AWAITING_COLLECTION', shippingType: 'TIKTOK', packageIds: ['PKG-LATE'] } });

    const label = await service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS);

    expect(tiktok.createPackage).toHaveBeenCalledTimes(1);
    expect(tiktok.getShippingDocument).toHaveBeenCalledWith(expect.anything(), 'PKG-LATE');
    expect(label).toMatchObject({ packageId: 'PKG-LATE', labelUrl: 'https://label.tiktok.test/PKG.pdf' });
    expect(podOrderUpdate).toHaveBeenCalled();
  });

  it('tạo gói TIMEOUT, đối soát xác nhận CHƯA có gói ⇒ TIKTOK_UNREACHABLE "bấm lại an toàn", tạo gói đúng 1 lần', async () => {
    const { service, tiktok, podOrderUpdate } = buildLabelService();
    tiktok.createPackage.mockRejectedValueOnce(networkError());

    const error = (await service
      .fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)
      .catch((caught: unknown) => caught)) as ShippingLabelUnavailableException;

    expect(error.getResponse()).toMatchObject({ code: 'TIKTOK_UNREACHABLE', details: { operation: 'CREATE_PACKAGE' } });
    expect(error.message).toContain('CHƯA tạo gói');
    expect(tiktok.createPackage).toHaveBeenCalledTimes(1);
    expect(podOrderUpdate).not.toHaveBeenCalled();
  });

  it('tạo gói TIMEOUT và KHÔNG đối soát được ⇒ báo chưa xác nhận, KHÔNG tạo lại', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.createPackage.mockRejectedValueOnce(networkError());
    tiktok.getOrderFulfillmentInfo
      .mockResolvedValueOnce({ data: { found: true, status: 'AWAITING_SHIPMENT', shippingType: 'TIKTOK', packageIds: [] } })
      .mockRejectedValue(networkError());

    const error = (await service
      .fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)
      .catch((caught: unknown) => caught)) as ShippingLabelUnavailableException;

    expect(error.getResponse()).toMatchObject({ code: 'TIKTOK_UNREACHABLE' });
    expect(error.message).toContain('chưa xác nhận');
    expect(tiktok.createPackage).toHaveBeenCalledTimes(1);
  });

  it('TikTok TỪ CHỐI tạo gói (4xx nghiệp vụ) ⇒ TIKTOK_PACKAGE_CREATE_FAILED kèm lý do nguyên văn, không đối soát', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.createPackage.mockRejectedValueOnce(
      new TiktokClientError(TiktokErrorClass.BUSINESS, 21011024, 'Shipping service is unavailable', 200, 'req-cp', 'FULFILLMENT_CREATE_PACKAGE'),
    );

    const error = (await service
      .fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)
      .catch((caught: unknown) => caught)) as ShippingLabelUnavailableException;

    expect(error.getResponse()).toMatchObject({
      code: 'TIKTOK_PACKAGE_CREATE_FAILED',
      details: { operation: 'CREATE_PACKAGE', providerCode: '21011024', providerMessage: 'Shipping service is unavailable', requestId: 'req-cp' },
    });
    // Chỉ lần hỏi chi tiết đơn TRƯỚC khi tạo — không có vòng đối soát.
    expect(tiktok.getOrderFulfillmentInfo).toHaveBeenCalledTimes(1);
  });

  it('TikTok giới hạn tần suất ⇒ TIKTOK_RATE_LIMITED', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.getOrderFulfillmentInfo.mockRejectedValueOnce(
      new TiktokClientError(TiktokErrorClass.RATE_LIMIT, 36009004, 'Too many requests', 429, 'req-rl', 'ORDER_DETAIL'),
    );

    await expect(service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)).rejects.toMatchObject({
      response: { code: 'TIKTOK_RATE_LIMITED' },
    });
    expect(tiktok.createPackage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Nhãn đã có
  // -------------------------------------------------------------------------

  it('CASE 3 — đơn đã có nhãn TikTok, TikTok không cấp lại được file ⇒ trả NHÃN ĐÃ LƯU kèm cảnh báo, không tạo gói', async () => {
    const { service, tiktok, podOrderUpdate } = buildLabelService({
      shippingLabelPackageId: 'PKG-CU',
      shippingLabelUrl: 'https://label.tiktok.test/cu.pdf',
      shippingLabelSource: 'TIKTOK',
      shippingLabelTrackingNumber: 'TRK-CU',
    });
    tiktok.getShippingDocument.mockRejectedValueOnce(
      new TiktokClientError(
        TiktokErrorClass.BUSINESS,
        21042102,
        "Documents couldn't be printed after the package has been pickup.",
        200,
        'req-pick',
        'FULFILLMENT_SHIPPING_DOCUMENT',
      ),
    );

    const label = await service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS);

    expect(label).toMatchObject({
      labelUrl: 'https://label.tiktok.test/cu.pdf',
      packageId: 'PKG-CU',
      trackingNumber: 'TRK-CU',
      refreshed: false,
      reusedPackage: true,
    });
    expect(label.warning).toContain("couldn't be printed");
    expect(tiktok.createPackage).not.toHaveBeenCalled();
    expect(tiktok.getOrderFulfillmentInfo).not.toHaveBeenCalled();
    expect(podOrderUpdate).not.toHaveBeenCalled();
  });

  it('CASE 2 — đơn có gói nhưng chưa có nhãn ⇒ dùng lại gói, lấy tài liệu, LƯU nhãn', async () => {
    const { service, tiktok, podOrderUpdate } = buildLabelService({
      packages: [{ tiktokPackageId: 'PKG-SYNC', shippingServiceName: 'USPS Ground Advantage' }],
    });

    const label = await service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS);

    expect(tiktok.createPackage).not.toHaveBeenCalled();
    expect(label).toMatchObject({ packageId: 'PKG-SYNC', refreshed: true, shippingServiceName: 'USPS Ground Advantage' });
    expect(podOrderUpdate).toHaveBeenCalled();
  });

  it('CASE 4 — bấm hai lần liên tiếp: lần hai thấy gói lần một đã lưu ⇒ KHÔNG tạo gói thứ hai', async () => {
    const first = buildLabelService();
    await first.service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS);
    const saved = (first.podOrderUpdate.mock.calls.at(-1) as unknown[])[0] as { data: Record<string, unknown> };

    const second = buildLabelService({ ...saved.data });
    await second.service.fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS);

    expect(first.tiktok.createPackage).toHaveBeenCalledTimes(1);
    expect(second.tiktok.createPackage).not.toHaveBeenCalled();
    expect(second.tiktok.getShippingDocument).toHaveBeenCalledWith(expect.anything(), 'PKG-NEW');
  });

  // -------------------------------------------------------------------------
  // Lỗi hệ thống: không 500 trần, không lộ chi tiết kỹ thuật
  // -------------------------------------------------------------------------

  it('🔴 lỗi hệ thống (vd Prisma) ⇒ 422 SHIPPING_LABEL_INTERNAL_ERROR + mã tham chiếu, KHÔNG lộ thông điệp kỹ thuật', async () => {
    const { service, tiktok } = buildLabelService({}, {
      repoError: new Error('Invalid `prisma.podOrder.findFirst()` invocation: column pod_orders.shipping_label_url does not exist'),
    });

    const error = (await service
      .fetchFromTiktok('org-1', 'user-1', 'order-1', {}, ALL_SHOPS)
      .catch((caught: unknown) => caught)) as ShippingLabelUnavailableException;

    expect(error).toBeInstanceOf(ShippingLabelUnavailableException);
    expect(error.getStatus()).toBe(422);
    const body = error.getResponse() as { code: string; message: string; details: { referenceId: string } };
    expect(body.code).toBe('SHIPPING_LABEL_INTERNAL_ERROR');
    expect(body.details.referenceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.message).toContain(body.details.referenceId);
    expect(JSON.stringify(body)).not.toMatch(/prisma|pod_orders|column/i);
    expect(tiktok.createPackage).not.toHaveBeenCalled();
  });

  it('Test 9 — nhãn đã lưu đọc lại được từ bản ghi đơn (sau khi tải lại trang)', () => {
    const label = FulfillmentShippingLabelService.labelOf({
      shippingLabelUrl: 'https://label.tiktok.test/PKG.pdf',
      shippingLabelSource: 'TIKTOK',
      shippingLabelPackageId: 'PKG-NEW',
      shippingLabelTrackingNumber: 'TRK-9',
      shippingLabelAt: new Date('2026-09-24T10:00:00.000Z'),
    });

    expect(label).toMatchObject({
      labelUrl: 'https://label.tiktok.test/PKG.pdf',
      source: 'TIKTOK',
      packageId: 'PKG-NEW',
      trackingNumber: 'TRK-9',
      obtainedAt: '2026-09-24T10:00:00.000Z',
    });
  });

  it('chưa có nhãn ⇒ `labelOf` trả null (không dựng nhãn rỗng)', () => {
    expect(
      FulfillmentShippingLabelService.labelOf({
        shippingLabelUrl: null,
        shippingLabelSource: null,
        shippingLabelPackageId: null,
        shippingLabelTrackingNumber: null,
        shippingLabelAt: null,
      }),
    ).toBeNull();
  });
});

describe('FulfillmentShippingLabelService.saveManualLabel', () => {
  it('Test 4b — lưu URL dán tay XUỐNG DATABASE (không chỉ giữ ở giao diện)', async () => {
    const { service, podOrderUpdate } = buildLabelService();

    const label = await service.saveManualLabel(
      'org-1',
      'user-1',
      'order-1',
      '  https://seller-us.tiktok.com/easesafe/label.pdf  ',
      ALL_SHOPS,
    );

    const data = (podOrderUpdate.mock.calls.at(-1) as unknown[])[0] as {
      data: Record<string, unknown>;
    };
    expect(data.data).toMatchObject({
      shippingLabelUrl: 'https://seller-us.tiktok.com/easesafe/label.pdf',
      shippingLabelSource: 'MANUAL',
      shippingLabelPackageId: null,
    });
    expect(label.source).toBe('MANUAL');
  });
});

describe('Nhãn TikTok — phạm vi shop (Seller)', () => {
  it('Seller lấy nhãn cho đơn của CHÍNH shop mình ⇒ được', async () => {
    const { service, tiktok } = buildLabelService();

    await service.fetchFromTiktok('org-1', 'seller', 'order-1', {}, OWN_SHOP_SELLER);

    expect(tiktok.createPackage).toHaveBeenCalledTimes(1);
  });

  it('🔴 Seller lấy nhãn cho đơn shop KHÁC ⇒ 403, KHÔNG gọi TikTok (không tạo gói)', async () => {
    const { service, tiktok, podOrderUpdate } = buildLabelService();

    await expect(
      service.fetchFromTiktok('org-1', 'seller', 'order-1', {}, OTHER_SHOP_SELLER),
    ).rejects.toBeInstanceOf(PodShopForbiddenException);
    expect(tiktok.getOrderFulfillmentInfo).not.toHaveBeenCalled();
    expect(tiktok.createPackage).not.toHaveBeenCalled();
    expect(podOrderUpdate).not.toHaveBeenCalled();
  });

  it('Seller lưu / gỡ nhãn đơn shop KHÁC ⇒ 403, không ghi database', async () => {
    const { service, podOrderUpdate } = buildLabelService();

    await expect(
      service.saveManualLabel('org-1', 'seller', 'order-1', 'https://x.test/l.pdf', OTHER_SHOP_SELLER),
    ).rejects.toBeInstanceOf(PodShopForbiddenException);
    await expect(service.clearLabel('org-1', 'order-1', OTHER_SHOP_SELLER)).rejects.toBeInstanceOf(
      PodShopForbiddenException,
    );
    expect(podOrderUpdate).not.toHaveBeenCalled();
  });
});
