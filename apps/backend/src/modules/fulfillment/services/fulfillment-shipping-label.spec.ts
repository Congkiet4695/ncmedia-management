import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import { PodTiktokShopContextService } from '../../pod-tiktok/services/pod-tiktok-shop-context.service';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { TiktokErrorClass } from '../../pod-tiktok/constants/tiktok-error-code.constants';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
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

interface LabelHarness {
  service: FulfillmentShippingLabelService;
  tiktok: Record<string, jest.Mock>;
  podOrderUpdate: jest.Mock;
  packageUpsert: jest.Mock;
}

function buildLabelService(
  orderOverrides: Record<string, unknown> = {},
  options: { lockBusy?: boolean } = {},
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
    findById: jest.fn().mockResolvedValue(order(orderOverrides)),
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
  );

  return { service, tiktok, podOrderUpdate, packageUpsert };
}

describe('FulfillmentShippingLabelService.fetchFromTiktok', () => {
  it('Test 5 — chưa có gói ⇒ hỏi dịch vụ → tạo gói → lấy nhãn → LƯU đủ nhãn/gói/tracking', async () => {
    const { service, tiktok, podOrderUpdate, packageUpsert } = buildLabelService();

    const label = await service.fetchFromTiktok('org-1', 'user-1', 'order-1');

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

    const label = await service.fetchFromTiktok('org-1', 'user-1', 'order-1');

    expect(tiktok.createPackage).not.toHaveBeenCalled();
    expect(tiktok.queryShippingServices).not.toHaveBeenCalled();
    expect(tiktok.getShippingDocument).toHaveBeenCalledWith(expect.anything(), 'PKG-CU');
    expect(label.reusedPackage).toBe(true);
  });

  it('Test 8 — đơn đã có gói ĐỒNG BỘ TỪ TIKTOK ⇒ dùng lại gói đó, không tạo gói mới', async () => {
    const { service, tiktok } = buildLabelService({
      packages: [{ tiktokPackageId: 'PKG-SYNC', shippingServiceName: null }],
    });

    const label = await service.fetchFromTiktok('org-1', 'user-1', 'order-1');

    expect(tiktok.createPackage).not.toHaveBeenCalled();
    expect(label.packageId).toBe('PKG-SYNC');
    expect(label.reusedPackage).toBe(true);
  });

  it('Test 6b — hai người bấm cùng lúc: lượt thứ hai bị khoá chặn, không tạo gói', async () => {
    const { service, tiktok } = buildLabelService({}, { lockBusy: true });

    await expect(service.fetchFromTiktok('org-1', 'user-1', 'order-1')).rejects.toBeInstanceOf(
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
      .fetchFromTiktok('org-1', 'user-1', 'order-1')
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

    await expect(service.fetchFromTiktok('org-1', 'user-1', 'order-1')).rejects.toMatchObject({
      response: { code: 'TIKTOK_SCOPE_MISSING' },
    });
  });

  it('TikTok không có dịch vụ vận chuyển nào ⇒ báo đúng lý do, không tạo gói', async () => {
    const { service, tiktok } = buildLabelService();
    tiktok.queryShippingServices.mockResolvedValueOnce({ data: { shippingServices: [] } });

    await expect(service.fetchFromTiktok('org-1', 'user-1', 'order-1')).rejects.toMatchObject({
      response: { code: 'TIKTOK_NO_ELIGIBLE_SHIPPING_SERVICE' },
    });
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
