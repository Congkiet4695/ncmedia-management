import {
  escapeHtml,
  formatDateTime,
  formatMoney,
  formatTelegramMessage,
} from './telegram-message.formatter';
import type {
  FulfillmentCancelledPayload,
  FulfillmentSubmittedPayload,
  OrderCreatedPayload,
  ReturnRefundRequestPayload,
} from '../types/notification-payload.types';

const CTX = { organizationName: 'HN Media', timezoneOffsetMinutes: 420 };

const ORDER: OrderCreatedPayload = {
  tiktokOrderId: '577593225638089493',
  sellerName: 'Nguyễn Minh Chinh',
  accountName: 'AZ_VTR_31',
  shopName: 'Sunday Crew',
  items: [
    {
      productName: 'Dolly Parton Signature Vintage Graphic Sweatshirt',
      sku: 'HUYNH_187',
      variant: 'M / Dark Heather',
      quantity: 1,
    },
  ],
  totalAmount: '20.45',
  currency: 'USD',
  orderCreatedAt: '2026-09-29T03:00:00.000Z',
  fulfillmentProvider: 'Mango',
  syncSource: 'CRON',
};

describe('formatTelegramMessage', () => {
  it('NEW ORDER — đủ các dòng từ dữ liệu thật, giờ theo UTC+7', () => {
    const text = formatTelegramMessage('ORDER_CREATED', ORDER, CTX);
    expect(text).toContain('🛒 <b>NEW ORDER</b>');
    expect(text).toContain('<b>Seller:</b> Nguyễn Minh Chinh');
    expect(text).toContain('<b>Shop:</b> Sunday Crew');
    // Tài khoản TikTok khác tên shop ⇒ hiện thêm để phân biệt.
    expect(text).toContain('<b>TikTok account:</b> AZ_VTR_31');
    // Seller / Shop đứng TRƯỚC Order ID.
    expect(text.indexOf('Seller:')).toBeLessThan(text.indexOf('Order ID:'));
    expect(text).toContain('<code>577593225638089493</code>');
    expect(text).toContain('Dolly Parton Signature Vintage Graphic Sweatshirt');
    expect(text).toContain('<b>Variant:</b> M / Dark Heather');
    expect(text).toContain('<b>Quantity:</b> 1');
    expect(text).toContain('$20.45');
    expect(text).toContain('29/09/2026 10:00 (UTC+7)');
    expect(text).toContain('<b>Fulfillment:</b> Mango');
    expect(text).toContain('<b>Organization:</b> HN Media');
  });

  it('NEW ORDER — shop trùng tên tài khoản ⇒ không lặp dòng; chưa gán seller ⇒ "Not assigned"', () => {
    const text = formatTelegramMessage('ORDER_CREATED', { ...ORDER, shopName: 'AZ_VTR_31', sellerName: null }, CTX);
    expect(text).toContain('<b>Seller:</b> Not assigned');
    expect(text).toContain('<b>Shop:</b> AZ_VTR_31');
    expect(text).not.toContain('TikTok account:');
  });

  it('NEW ORDER — sự kiện ghi trước khi có trường seller ⇒ bỏ dòng Seller, không đoán', () => {
    const { sellerName: _omit, ...legacy } = ORDER;
    void _omit;
    const text = formatTelegramMessage('ORDER_CREATED', legacy, CTX);
    expect(text).not.toContain('Seller:');
    expect(text).toContain('<b>Shop:</b> Sunday Crew');
  });

  it('NEW ORDER — không chứa thông tin nhạy cảm người mua (payload không mang các trường đó)', () => {
    const text = formatTelegramMessage('ORDER_CREATED', ORDER, CTX);
    expect(text).not.toMatch(/address|phone|email|token/i);
  });

  it('NEW ORDER nhiều sản phẩm ⇒ danh sách đánh số kèm Variant / Qty', () => {
    const text = formatTelegramMessage(
      'ORDER_CREATED',
      {
        ...ORDER,
        items: [
          { productName: 'Product A', sku: 'A', variant: 'M / Black', quantity: 1 },
          { productName: 'Product B', sku: 'B', variant: 'XL / White', quantity: 2 },
        ],
      },
      CTX,
    );
    expect(text).toContain('📦 <b>Items:</b>');
    expect(text).toContain('1. Product A');
    expect(text).toContain('2. Product B');
    expect(text).toContain('   Qty: 2');
  });

  it('field không có dữ liệu ⇒ bỏ dòng, không in null / undefined', () => {
    const text = formatTelegramMessage(
      'ORDER_CREATED',
      { ...ORDER, totalAmount: null, fulfillmentProvider: null, orderCreatedAt: null },
      { organizationName: null, timezoneOffsetMinutes: 420 },
    );
    expect(text).not.toMatch(/null|undefined|Total|Fulfillment|Order time|Organization/);
  });

  it('escape HTML trong dữ liệu tự do của seller', () => {
    const text = formatTelegramMessage(
      'ORDER_CREATED',
      { ...ORDER, items: [{ productName: '<b>Tee</b> & Co', sku: null, variant: null, quantity: 1 }] },
      CTX,
    );
    expect(text).toContain('&lt;b&gt;Tee&lt;/b&gt; &amp; Co');
  });

  it('nhiều sản phẩm quá giới hạn ⇒ gộp phần dư, tin không vượt 4096 ký tự', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      productName: `Product ${i} ${'x'.repeat(200)}`,
      sku: `SKU-${i}`,
      variant: 'M',
      quantity: 1,
    }));
    const text = formatTelegramMessage('ORDER_CREATED', { ...ORDER, items }, CTX);
    expect(text).toContain('…and 30 more item(s)');
    expect(text.length).toBeLessThanOrEqual(4096);
  });

  it('FULFILL SUCCESS — Seller / Shop / Provider / giá vốn đã xác nhận / Status', () => {
    const payload: FulfillmentSubmittedPayload = {
      tiktokOrderId: '5775',
      sellerName: 'Nguyễn Minh Chinh',
      shopName: 'Sunday Crew',
      status: 'SUBMITTED',
      accountName: 'AZ_VTR_31',
      items: ORDER.items,
      provider: 'MangoTeePrints',
      fulfilledBy: 'Mango US',
      providerOrderId: 'MG-123',
      externalOrderId: 'NC-5775',
      baseCost: '10.70',
      baseCostConfirmed: true,
      currency: 'USD',
      trackingNumber: null,
      productionLine: 'TIKTOK',
      shippingMethod: 'standard',
      fulfilledAt: '2026-09-29T03:00:00.000Z',
    };
    const text = formatTelegramMessage('FULFILLMENT_SUBMITTED', payload, CTX);
    expect(text).toContain('📦 <b>FULFILL SUCCESS</b>');
    expect(text).toContain('<b>Seller:</b> Nguyễn Minh Chinh');
    expect(text).toContain('<b>Shop:</b> Sunday Crew');
    expect(text).toContain('<b>Provider:</b> MangoTeePrints (Mango US)');
    expect(text).toContain('<b>Status:</b> Submitted');
    expect(text).toContain('<b>Time:</b> 29/09/2026 10:00');
    expect(text).toContain('<code>MG-123</code>');
    expect(text).toContain('$10.70');
    expect(text).toContain('<b>Production line:</b> TIKTOK');
    expect(text).toContain('<b>Shipping method:</b> standard');
    expect(text).not.toContain('Tracking');
  });

  it('ORDER FULFILLED — giá vốn CHƯA xác nhận ⇒ ghi "Pending", không in số tạm', () => {
    const text = formatTelegramMessage(
      'FULFILLMENT_SUBMITTED',
      {
        tiktokOrderId: '5775',
        accountName: null,
        items: [],
        provider: 'Sellerwix',
        fulfilledBy: null,
        providerOrderId: null,
        externalOrderId: '5775',
        baseCost: null,
        baseCostConfirmed: false,
        currency: null,
        trackingNumber: null,
        productionLine: null,
        shippingMethod: null,
        fulfilledAt: null,
      },
      CTX,
    );
    expect(text).toContain('Pending');
    // Không có mã nhà cung cấp ⇒ hiện mã NCMedia đã gửi.
    expect(text).toContain('<code>5775</code>');
  });

  it('FULFILL CANCELLED — Seller / Shop / Provider / Status / người huỷ / lý do', () => {
    const payload: FulfillmentCancelledPayload = {
      tiktokOrderId: '5775',
      shopName: 'Sunday Crew',
      accountName: 'AZ_VTR_31',
      items: [],
      provider: 'MangoTeePrints',
      fulfilledBy: 'MangoTeePrints',
      providerOrderId: 'MG-123',
      externalOrderId: 'NC-5775',
      cancelledAt: '2026-09-29T03:30:00.000Z',
      reason: 'Khách huỷ',
      sellerName: 'Seller Lan',
      cancelledBy: 'Seller Lan',
    };
    const text = formatTelegramMessage('FULFILLMENT_CANCELLED', payload, CTX);
    expect(text).toContain('↩️ <b>FULFILL CANCELLED</b>');
    expect(text).toContain('<b>Shop:</b> Sunday Crew');
    expect(text).toContain('<b>Provider:</b> MangoTeePrints');
    expect(text).toContain('29/09/2026 10:30');
    expect(text).toContain('<b>Reason:</b> Khách huỷ');
    expect(text).toContain('<b>Seller:</b> Seller Lan');
    expect(text).toContain('<b>Status:</b> Cancelled');
    expect(text).toContain('<b>Cancelled by:</b> Seller Lan');
  });

  it('FULFILLMENT CANCELLED — sự kiện cũ không có seller / người huỷ ⇒ bỏ dòng, không lỗi', () => {
    const text = formatTelegramMessage(
      'FULFILLMENT_CANCELLED',
      {
        tiktokOrderId: '5775',
        accountName: null,
        items: [],
        provider: 'Sellerwix',
        fulfilledBy: null,
        providerOrderId: 'SW-1',
        externalOrderId: '5775',
        cancelledAt: null,
        reason: null,
      },
      CTX,
    );
    expect(text).not.toMatch(/Seller:|Cancelled by|undefined|null/);
    expect(text).toContain('<b>Status:</b> Cancelled');
  });

  it('payload hỏng ⇒ ném lỗi (worker đánh FAILED, không gửi tin rỗng)', () => {
    expect(() =>
      formatTelegramMessage('ORDER_CREATED', {} as OrderCreatedPayload, CTX),
    ).toThrow();
  });
});

describe('helpers', () => {
  it('formatMoney', () => {
    expect(formatMoney('20.45', 'USD')).toBe('$20.45');
    expect(formatMoney('5', 'XYZ1')).toBe('5.00 XYZ1');
    expect(formatMoney(null, 'USD')).toBeNull();
    expect(formatMoney('abc', 'USD')).toBeNull();
  });

  it('formatDateTime theo offset, kể cả offset âm', () => {
    expect(formatDateTime('2026-09-29T00:00:00.000Z', -300)).toBe('28/09/2026 19:00 (UTC-5)');
    expect(formatDateTime('invalid', 420)).toBeNull();
  });

  it('escapeHtml', () => {
    expect(escapeHtml('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
  });
});

describe('formatTelegramMessage — RETURN_REFUND_REQUEST', () => {
  const RETURN: ReturnRefundRequestPayload = {
    tiktokReturnId: '4035123456789',
    tiktokOrderId: '577593225638089493',
    sellerName: 'Seller A',
    accountName: 'AZ_VTR_31',
    shopName: 'Sunday Crew',
    returnType: 'RETURN_AND_REFUND',
    reason: 'Damaged item',
    status: 'RETURN_OR_REFUND_REQUEST_PENDING',
    items: [{ productName: 'Tee <b>', sku: 'TEE-M', variant: 'M / Black', quantity: 2 }],
    currency: 'USD',
    paidAmount: '25.98',
    requestedRefundAmount: '25.98',
    requestedAt: '2026-10-01T03:00:00.000Z',
    link: 'https://app.example.com/dashboard/pod/returns?search=577593225638089493',
  };

  it('đủ các dòng: Order ID, Request ID, Type, Reason, Status, Item, Paid, Requested Refund, thời điểm, link', () => {
    const text = formatTelegramMessage('RETURN_REFUND_REQUEST', RETURN, CTX);
    expect(text).toContain('NEW RETURN / REFUND REQUEST');
    expect(text).toContain('<b>Seller:</b> Seller A');
    expect(text).toContain('<b>Order ID:</b> <code>577593225638089493</code>');
    expect(text).toContain('<b>Request ID:</b> <code>4035123456789</code>');
    expect(text).toContain('<b>Type:</b> Return and refund');
    expect(text).toContain('<b>Reason:</b> Damaged item');
    expect(text).toContain('<b>Quantity:</b> 2');
    expect(text).toContain('<b>Paid Amount:</b> $25.98');
    expect(text).toContain('<b>Requested Refund:</b> $25.98');
    expect(text).toContain('01/10/2026 10:00 (UTC+7)');
    expect(text).toContain('href="https://app.example.com/dashboard/pod/returns?search=577593225638089493"');
    expect(text).toContain('Tee &lt;b&gt;');
  });

  it('thiếu Paid Amount / số tiền / link ⇒ bỏ dòng, không in N/A giả; không có dòng tiền hoàn thực tế', () => {
    const text = formatTelegramMessage('RETURN_REFUND_REQUEST', { ...RETURN, paidAmount: null, requestedRefundAmount: null, link: null }, CTX);
    expect(text).not.toContain('Paid Amount');
    expect(text).not.toContain('Requested Refund');
    expect(text).not.toContain('href=');
    expect(text).not.toMatch(/Actual Refund|null|undefined/);
  });
});
