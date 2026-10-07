/* eslint-disable */
/**
 * TikTok Promotion GIẢ LẬP ở đúng ranh giới SDK (`TikTokSdkService.execute` + `api.PromotionV202309Api.*`)
 * và khoá phân tán trong bộ nhớ — dùng chung cho các kiểm thử tích hợp Flash Sale.
 * Không gọi TikTok thật. Xem chú thích hành vi ở `e2e-flash-sale-upgrade.manual.ts`.
 */
import { TiktokErrorClass } from '../../../src/modules/pod-tiktok/constants/tiktok-error-code.constants';
import { TiktokClientError } from '../../../src/modules/pod-tiktok/exceptions/pod-tiktok.exceptions';

export interface FakeSku { id: string; activityPrice: { amount: string; currency: string }; quantityLimit: number; quantityPerUser: number }
export interface FakeActivity {
  id: string;
  title: string;
  activityType: string;
  status: string;
  productLevel: string;
  beginTime: number;
  endTime: number;
  createTime: number;
  updateTime: number;
  activityCommands: string[];
  products: Map<string, { id: string; skus: Map<string, FakeSku> }>;
  /** `shop_cipher` của request đã tạo hoạt động — để kiểm cô lập theo shop. */
  shopCipher?: string;
}

export class FakeTiktok {
  constructor(private readonly RUN: string) {}

  activities = new Map<string, FakeActivity>();
  /** SKU mà TikTok lặng lẽ không nhận (lô vẫn thành công, `totalCount` thấp hơn). */
  silentlyRejected = new Set<string>();
  /** Số lời gọi Update Activity Products tiếp theo sẽ bị từ chối hẳn (lỗi nghiệp vụ). */
  failNextProductCalls = 0;
  /**
   * Sản phẩm TikTok KHÔNG còn bán: request Update Activity Products chứa một trong số này ⇒ TikTok từ
   * chối CẢ request với 17029016 "No SKU in the product matches" (hành vi thật đã gặp).
   */
  rejectProducts = new Set<string>();
  /** Số lời gọi Create Activity tiếp theo sẽ bị từ chối. */
  failNextCreateActivity = 0;
  /** SKU trong từng lời gọi Update Activity Products, theo thứ tự. */
  productCalls: string[][] = [];
  /** Kích thước trang Search Activities (nhỏ, để thử phân trang). */
  pageSize = 7;
  searchCalls = 0;
  private seq = 0;

  addActivity(input: Partial<FakeActivity> & { title: string }): FakeActivity {
    const now = Math.floor(Date.now() / 1000);
    const activity: FakeActivity = {
      id: `${this.RUN}-ACT-${++this.seq}`,
      activityType: 'FLASHSALE',
      status: 'ONGOING',
      productLevel: 'VARIATION',
      beginTime: now - 60,
      endTime: now + 86_400,
      createTime: now - 120,
      updateTime: now - 120,
      activityCommands: [],
      products: new Map(),
      ...input,
    };
    this.activities.set(activity.id, activity);
    return activity;
  }

  private ok<T>(data: T) {
    return { body: { code: 0, message: 'Success', data, requestId: `req-${++this.seq}` } };
  }

  private detail(activity: FakeActivity) {
    return {
      activityId: activity.id,
      activityType: activity.activityType,
      title: activity.title,
      status: activity.status,
      productLevel: activity.productLevel,
      beginTime: activity.beginTime,
      endTime: activity.endTime,
      createTime: activity.createTime,
      updateTime: activity.updateTime,
      activityCommands: activity.activityCommands,
      products: [...activity.products.values()].map((product) => ({
        id: product.id,
        skus: [...product.skus.values()],
      })),
    };
  }

  sdk() {
    const self = this;
    return {
      execute: async (call: { invoke: () => Promise<{ body: { code: number; data: unknown; requestId: string } }> }) => {
        const { body } = await call.invoke();
        return { data: body.data, requestId: body.requestId };
      },
      api: {
        PromotionV202309Api: {
          ActivitiesPost: async (_t: string, _c: string, cipher: string, req: any) => {
            if (self.failNextCreateActivity > 0) {
              self.failNextCreateActivity -= 1;
              throw new TiktokClientError(TiktokErrorClass.CLIENT_BUG, 17000998, 'Fake: activity creation rejected', 200, 'req-fail-create', 'PROMOTION_ACTIVITY_CREATE');
            }
            const a = self.addActivity({
              shopCipher: cipher,
              title: req.title,
              status: 'NOT_START',
              productLevel: req.productLevel,
              beginTime: req.beginTime,
              endTime: req.endTime,
            });
            return self.ok({ activityId: a.id, status: a.status });
          },
          ActivitiesActivityIdPut: async (id: string, _t: string, _c: string, _s: string, req: any) => {
            const a = self.activities.get(id)!;
            Object.assign(a, { title: req.title ?? a.title, beginTime: req.beginTime ?? a.beginTime, endTime: req.endTime ?? a.endTime });
            return self.ok(self.detail(a));
          },
          ActivitiesActivityIdProductsPut: async (id: string, _t: string, _c: string, _s: string, req: any) => {
            const skusInCall: string[] = req.products.flatMap((p: any) => p.skus.map((s: any) => s.id));
            self.productCalls.push(skusInCall);
            const notLive = req.products.find((p: any) => self.rejectProducts.has(p.id));
            if (notLive) {
              throw new TiktokClientError(TiktokErrorClass.BUSINESS, 17029016, `Resource Not Found: No SKU in the product matches ${notLive.id}`, 200, `req-17029016-${++self.seq}`, "PROMOTION_ACTIVITY_PRODUCTS_UPDATE");
            }
            if (self.failNextProductCalls > 0) {
              self.failNextProductCalls -= 1;
              throw new TiktokClientError(TiktokErrorClass.CLIENT_BUG, 17000999, 'Fake: product not eligible for promotion', 200, 'req-fail', 'PROMOTION_ACTIVITY_PRODUCTS_UPDATE');
            }
            const a = self.activities.get(id)!;
            let accepted = 0;
            for (const p of req.products) {
              // Mức PRODUCT: `skus` rỗng, giá nằm ở cấp sản phẩm.
              if (p.skus.length === 0) {
                if (self.silentlyRejected.has(p.id)) continue;
                a.products.set(p.id, { id: p.id, skus: new Map<string, FakeSku>() });
                accepted += 1;
                continue;
              }
              for (const s of p.skus) {
                if (self.silentlyRejected.has(s.id)) continue;
                const product = a.products.get(p.id) ?? { id: p.id, skus: new Map<string, FakeSku>() };
                product.skus.set(s.id, {
                  id: s.id,
                  activityPrice: { amount: s.activityPriceAmount, currency: 'USD' },
                  quantityLimit: s.quantityLimit ?? -1,
                  quantityPerUser: s.quantityPerUser ?? -1,
                });
                a.products.set(p.id, product);
                accepted += 1;
              }
            }
            a.updateTime = Math.floor(Date.now() / 1000);
            return self.ok({ activityId: id, status: a.status, title: a.title, totalCount: accepted, updateTime: a.updateTime });
          },
          ActivitiesActivityIdGet: async (id: string) => self.ok(self.detail(self.activities.get(id)!)),
          ActivitiesActivityIdDeactivatePost: async (id: string) => {
            const a = self.activities.get(id)!;
            a.status = 'DEACTIVATED';
            return self.ok({ activityId: id, status: a.status });
          },
          ActivitiesSearchPost: async (_t: string, _c: string, _s: string, req: any) => {
            self.searchCalls += 1;
            const all = [...self.activities.values()].filter((a) => !req.activityType || a.activityType === req.activityType);
            const start = req.pageToken ? Number(req.pageToken) : 0;
            const page = all.slice(start, start + self.pageSize);
            const next = start + self.pageSize < all.length ? String(start + self.pageSize) : '';
            return self.ok({
              activities: page.map((a) => ({
                id: a.id,
                activityType: a.activityType,
                title: a.title,
                status: a.status,
                beginTime: a.beginTime,
                endTime: a.endTime,
                productLevel: a.productLevel,
                createTime: a.createTime,
                updateTime: a.updateTime,
                activityCommands: a.activityCommands,
              })),
              nextPageToken: next,
              totalCount: all.length,
            });
          },
        },
      },
    };
  }
}

/** Khoá phân tán giả lập trong tiến trình — cùng hợp đồng acquire/renew/release. */
export class MemoryLocks {
  private held = new Set<string>();
  async acquire(key: string) {
    if (this.held.has(key)) return null;
    this.held.add(key);
    return { key, fenceToken: key };
  }
  async renew() { return true; }
  async release(lock: { key: string }) { this.held.delete(lock.key); }
}

