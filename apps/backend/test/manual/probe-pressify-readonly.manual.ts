/* eslint-disable */
/**
 * Dò Pressify Seller API THẬT — CHỈ ĐỌC — qua đúng code chạy production (PressifyApiClient / CredentialService /
 * PressifyFulfillmentService.testConnection). KHÔNG tạo / huỷ đơn, không gọi endpoint ghi.
 *
 * Chạy:
 *   PRESSIFY_API_KEY=<Store API key> node -r ts-node/register test/manual/probe-pressify-readonly.manual.ts
 *
 * 🔴 Key CHỈ đọc từ biến môi trường, không bao giờ in ra; kết quả chỉ in cấu trúc / số lượng (không PII đơn hàng).
 */
import { FulfillmentProvider } from '@prisma/client';
import { PressifyApiClient } from '../../src/modules/fulfillment/pressify/clients/pressify-api.client';
import { PressifyCredentialService } from '../../src/modules/fulfillment/pressify/services/pressify-credential.service';
import { PressifyFulfillmentService } from '../../src/modules/fulfillment/pressify/services/pressify-fulfillment.service';
import { PressifyOrderMapper } from '../../src/modules/fulfillment/pressify/mappers/pressify-order.mapper';

const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);

async function main(): Promise<void> {
  const key = process.env.PRESSIFY_API_KEY?.trim();
  if (!key) throw new Error('Thiếu PRESSIFY_API_KEY.');
  const redact = (text: string) => text.split(key).join('***');

  const identity = { encrypt: (v: string) => v, decrypt: (v: string) => v } as never;
  const credentials = new PressifyCredentialService(identity);
  const client = new PressifyApiClient({
    get: (_k: string, fallback?: unknown) => fallback,
  } as never);
  const updates: unknown[] = [];
  const repo = {
    updateAccount: (_id: string, data: unknown) => (updates.push(data), Promise.resolve()),
  } as never;
  const service = new PressifyFulfillmentService(
    { get: () => undefined } as never,
    repo,
    {} as never,
    {} as never,
    {} as never,
    client,
    new PressifyOrderMapper(),
    credentials,
    {} as never,
  );
  const account = (apiKey: string) =>
    ({
      id: 'probe',
      name: 'Probe',
      provider: FulfillmentProvider.PRESSIFY,
      isActive: true,
      apiKeyEnc: apiKey,
      providerConfig: null,
      baseUrlOverride: null,
    }) as never;

  // 1. Test connection — key thật / key sai.
  const ok = await service.testConnection(account(key));
  check(
    'Test connection với Store API key thật ⇒ Connected',
    ok.connected,
    `${ok.message} · ${ok.durationMs}ms`,
  );
  const bad = await service.testConnection(account('invalid-key-probe-000'));
  check(
    'Test connection với key sai ⇒ không kết nối, thông báo rõ',
    !bad.connected,
    redact(bad.message),
  );
  check('Kết quả / thông báo không chứa key', !JSON.stringify([ok, bad, updates]).includes(key));

  // 2. Đọc đơn của store (chỉ đọc) — xác nhận dạng dữ liệu, KHÔNG in PII.
  const ctx = credentials.buildContext(account(key) as never);
  const list = await client.listOrders(ctx, { perPage: 5 });
  const orders = list.data.data ?? [];
  check(
    'GET /orders đọc được (chỉ đọc)',
    Array.isArray(orders),
    `${orders.length} đơn · meta ${JSON.stringify(list.data.meta)}`,
  );
  if (orders[0]) {
    const detail = await client.getOrder(ctx, String(orders[0].id));
    const mapper = new PressifyOrderMapper();
    const summary = mapper.summarizeStatus(detail.data);
    const costs = mapper.orderCosts(detail.data);
    const lines = mapper.lineCosts(detail.data);
    check(
      'GET /order/{id} ⇒ trạng thái chuẩn hoá + chi phí + chi phí dòng',
      Boolean(summary.status),
      `fulfill_status=${detail.data.fulfill_status} → ${summary.status} · payment=${detail.data.payment_status} · costs=${JSON.stringify(costs)} · lines=${JSON.stringify(lines.map((line) => ({ variantId: line.variantId, itemCost: line.itemCost })))}`,
    );
    const masked = JSON.stringify(mapper.maskOrderForStorage(detail.data));
    check(
      'Đơn đã che PII trước khi lưu',
      !detail.data.address_1 || !masked.includes(String(detail.data.address_1)),
    );
  }
}

main()
  .then(() => {
    console.log(results.join('\n'));
    const failed = results.filter((line) => line.startsWith('FAIL')).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  })
  .catch((error) => {
    console.log(results.join('\n'));
    console.error('Probe lỗi:', (error as Error).message);
    process.exitCode = 1;
  });
