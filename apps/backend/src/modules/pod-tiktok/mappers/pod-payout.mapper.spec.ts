import { PodPayoutStatus, PodStatementTxType, Prisma } from '@prisma/client';
import { PodPayoutMapper } from './pod-payout.mapper';
import { TiktokPayment, TiktokStatement } from '../types/tiktok-finance.types';

/** Payload payment thật (rút gọn) lấy từ Get Payments của shop US. */
function payment(over: Partial<TiktokPayment> = {}): TiktokPayment {
  return {
    id: '3480446196982649387',
    status: 'PAID',
    create_time: 1785552667,
    paid_time: 1785779843,
    amount: { value: '3.26', currency: 'USD' },
    settlement_amount: { value: '3.26', currency: 'USD' },
    payment_amount_before_exchange: { value: '3.26', currency: 'USD' },
    exchange_rate: '1',
    bank_account: '********8894',
    ...over,
  };
}

function statement(over: Partial<TiktokStatement> = {}): TiktokStatement {
  return {
    id: '7668360286087530254',
    statement_time: 1785456000,
    settlement_amount: '22.47',
    currency: 'USD',
    revenue_amount: '29.99',
    fee_amount: '-1.8',
    adjustment_amount: '0',
    payment_status: 'PAID',
    payment_id: '3480370496699077163',
    payment_time: 1785518777,
    net_sales_amount: '29.99',
    shipping_cost_amount: '-5.72',
    ...over,
  };
}

describe('PodPayoutMapper', () => {
  let mapper: PodPayoutMapper;

  beforeEach(() => {
    mapper = new PodPayoutMapper();
    // Bản ghi bị bỏ qua đều ghi log warn — nuốt log để output test sạch.
    jest.spyOn(mapper['logger'], 'warn').mockImplementation(() => undefined);
  });

  describe('mapPayment', () => {
    it('giữ nguyên số tiền TikTok trả về (KHÔNG tự tính lại)', () => {
      const result = mapper.mapPayment(payment())!;
      expect(result.data.amount.toString()).toBe('3.26');
      expect(result.data.currency).toBe('USD');
      expect(result.data.status).toBe(PodPayoutStatus.PAID);
    });

    it('🔴 tiền là Decimal, không đi qua parseFloat (giữ nguyên độ chính xác)', () => {
      const result = mapper.mapPayment(payment({ amount: { value: '1234.5678', currency: 'USD' } }))!;
      expect(result.data.amount).toBeInstanceOf(Prisma.Decimal);
      expect(result.data.amount.toString()).toBe('1234.5678');
    });

    it('paid_time = 0 (chưa chi trả) → paidAt null, không phải 1970', () => {
      const result = mapper.mapPayment(payment({ status: 'PROCESSING', paid_time: 0 }))!;
      expect(result.data.paidAt).toBeNull();
      expect(result.data.status).toBe(PodPayoutStatus.PROCESSING);
    });

    it('quy đổi create_time sang mốc thời gian dùng để lọc', () => {
      const result = mapper.mapPayment(payment({ create_time: 1785552667 }))!;
      expect(result.data.paymentCreateTime).toBe(1785552667n);
      expect(result.data.paymentCreatedAt.toISOString()).toBe('2026-08-01T02:51:07.000Z');
    });

    it('🔴 trạng thái lạ (vd CANCELLED — TikTok KHÔNG có) → bỏ qua bản ghi, không đoán bừa', () => {
      expect(mapper.mapPayment(payment({ status: 'CANCELLED' }))).toBeNull();
      expect(mapper.mapPayment(payment({ status: undefined }))).toBeNull();
    });

    it('thiếu id → bỏ qua', () => {
      expect(mapper.mapPayment(payment({ id: undefined }))).toBeNull();
    });

    it('cùng payload → cùng hash; đổi trạng thái → hash đổi', () => {
      expect(mapper.mapPayment(payment())!.payloadHash).toBe(mapper.mapPayment(payment())!.payloadHash);
      expect(mapper.mapPayment(payment())!.payloadHash).not.toBe(
        mapper.mapPayment(payment({ status: 'PROCESSING' }))!.payloadHash,
      );
    });

    it('hash không phụ thuộc thứ tự key', () => {
      const a = payment();
      const b = Object.fromEntries(Object.entries(a).reverse()) as TiktokPayment;
      expect(mapper.mapPayment(a)!.payloadHash).toBe(mapper.mapPayment(b)!.payloadHash);
    });

    it('giữ số tài khoản đã được TikTok che, không cố xử lý thêm', () => {
      expect(mapper.mapPayment(payment())!.data.bankAccountMasked).toBe('********8894');
    });
  });

  describe('mapStatement', () => {
    it('ánh xạ đủ các khoản tiền và liên kết payment_id', () => {
      const result = mapper.mapStatement(statement())!;
      expect(result.data.settlementAmount.toString()).toBe('22.47');
      expect(result.data.feeAmount!.toString()).toBe('-1.8');
      expect(result.data.tiktokPaymentId).toBe('3480370496699077163');
      expect(result.data.paymentStatus).toBe(PodPayoutStatus.PAID);
    });

    it('statement chưa gắn payment → tiktokPaymentId null (nối ở bước sau)', () => {
      expect(mapper.mapStatement(statement({ payment_id: '' }))!.data.tiktokPaymentId).toBeNull();
    });

    it('trạng thái lạ → bỏ qua', () => {
      expect(mapper.mapStatement(statement({ payment_status: 'UNKNOWN' }))).toBeNull();
    });

    it('trường tiền rỗng → null, KHÔNG ép về 0 (0 và "không có" là hai nghĩa khác nhau)', () => {
      const result = mapper.mapStatement(statement({ revenue_amount: '', net_sales_amount: undefined }))!;
      expect(result.data.revenueAmount).toBeNull();
      expect(result.data.netSalesAmount).toBeNull();
    });
  });

  describe('mapStatementTransaction', () => {
    it('dòng ORDER lấy order_id', () => {
      const result = mapper.mapStatementTransaction(
        { id: 't1', type: 'ORDER', order_id: '577437697813484496', settlement_amount: '22.47' },
        'USD',
      )!;
      expect(result.data.type).toBe(PodStatementTxType.ORDER);
      expect(result.data.tiktokOrderId).toBe('577437697813484496');
    });

    it('dòng RESERVE lấy associated_order_id', () => {
      const result = mapper.mapStatementTransaction(
        {
          id: 't2',
          type: 'RESERVE',
          reserve_id: '3477488838743462443',
          associated_order_id: '577437697813484496',
          settlement_amount: '3.26',
        },
        'USD',
      )!;
      expect(result.data.type).toBe(PodStatementTxType.RESERVE);
      expect(result.data.tiktokOrderId).toBe('577437697813484496');
      expect(result.data.reserveId).toBe('3477488838743462443');
    });

    it('dòng ADJUSTMENT lấy adjustment_order_id', () => {
      const result = mapper.mapStatementTransaction(
        { id: 't3', type: 'ADJUSTMENT', adjustment_id: 'adj-1', adjustment_order_id: 'o-9' },
        'USD',
      )!;
      expect(result.data.type).toBe(PodStatementTxType.ADJUSTMENT);
      expect(result.data.tiktokOrderId).toBe('o-9');
    });

    it('🔴 loại giao dịch lạ → OTHER (giữ được bản ghi, không làm vỡ đồng bộ)', () => {
      const result = mapper.mapStatementTransaction({ id: 't4', type: 'SOMETHING_NEW' }, 'USD')!;
      expect(result.data.type).toBe(PodStatementTxType.OTHER);
    });

    it('lấy currency từ cấp statement vì dòng giao dịch không mang currency', () => {
      expect(mapper.mapStatementTransaction({ id: 't5', type: 'ORDER' }, 'GBP')!.data.currency).toBe(
        'GBP',
      );
    });

    it('thiếu id → bỏ qua', () => {
      expect(mapper.mapStatementTransaction({ type: 'ORDER' }, 'USD')).toBeNull();
    });
  });
});
