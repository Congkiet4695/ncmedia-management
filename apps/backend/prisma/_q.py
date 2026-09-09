import io, re, sys
sys.stdout.reconfigure(encoding='utf-8')

# ============================================================ PodProductSyncService.scheduleShopSync
p = 'src/modules/pod-product/services/pod-product-sync.service.ts'
s = io.open(p, encoding='utf-8').read()

anchor = "  async syncShops("
assert anchor in s, 'syncShops anchor'
method = '''  /**
   * Hẹn đồng bộ sản phẩm cho MỘT shop sau `POD_PRODUCT_SYNC_PUBLISH_DELAY_MS`.
   *
   * 🔴 Đây là cửa DUY NHẤT để đặt lịch đồng bộ hoãn. Nó không tự chạy gì cả — chỉ ghi một
   * dòng vào hàng đợi Redis; `PodProductSyncJob` mới là nơi lấy ra và gọi `syncShops`. Nhờ
   * vậy luồng publish trả về ngay, không giữ request nào sống 5 phút.
   *
   * 🔴 Phạm vi đúng MỘT shop. Nơi gọi truyền `shopId` của chính listing vừa publish, và
   * `syncShops({ shopId })` ở tick sau cũng chỉ đụng đúng shop đó — không có đường nào dẫn
   * tới `syncShops({})` toàn cục.
   *
   * Lỗi Redis KHÔNG được ném ra ngoài: publish đã thành công rồi, mất một lần hẹn đồng bộ
   * không được phép biến thành publish thất bại. Lượt theo lịch vẫn quét tới sau đó.
   */
  async scheduleShopSync(shopId: string): Promise<Date | null> {
    try {
      const dueAt = await this.queue.schedule(
        shopId,
        POD_PRODUCT_SYNC_PUBLISH_DELAY_MS,
        POD_PRODUCT_SYNC_PUBLISH_MAX_WAIT_MS,
      );

      this.logger.log({
        module: 'pod-product',
        operation: 'sync.schedule',
        shopId,
        dueAt: dueAt.toISOString(),
        msg: 'Đã hẹn đồng bộ sản phẩm cho shop sau khi publish listing',
      });
      return dueAt;
    } catch (error) {
      this.logger.error({
        module: 'pod-product',
        operation: 'sync.schedule.fail',
        shopId,
        msg: error instanceof Error ? error.message : 'Lỗi không xác định',
      });
      return null;
    }
  }

  /**
   * Chạy các lượt đồng bộ ĐẾN HẠN trong hàng đợi hoãn. Gọi bởi `PodProductSyncJob`.
   *
   * 🔴 Mỗi shop một lượt `syncShops({ shopId })` RIÊNG. Không gom thành một lời gọi chung:
   * một shop hỏng (token chết) không được kéo theo các shop còn lại, và mỗi shop phải có
   * dòng lịch sử đồng bộ của riêng nó.
   */
  async runDueShopSyncs(): Promise<{ shops: number; failed: number }> {
    const shopIds = await this.queue.claimDue(POD_PRODUCT_SYNC_DUE_BATCH);
    if (shopIds.length === 0) return { shops: 0, failed: 0 };

    let failed = 0;
    for (const shopId of shopIds) {
      try {
        // 🔴 `{ shopId }` — phạm vi đúng một shop. `organizationId` KHÔNG cần truyền: tenant
        // được lấy từ chính bản ghi shop trong `findSyncTargets` (nguyên tắc P5 của tiến
        // trình nền), nên không có đường nào chạm sang tổ chức khác.
        const outcomes = await this.syncShops({ shopId }, { trigger: PodProductSyncTrigger.SCHEDULER });
        if (outcomes.some((outcome) => outcome.status === PodProductSyncStatus.FAILED)) {
          failed += 1;
          await this.queue.requeue(shopId, POD_PRODUCT_SYNC_REQUEUE_DELAY_MS);
        }
      } catch (error) {
        failed += 1;
        // Lỗi hạ tầng (Redis/DB) ⇒ hẹn lại. Lỗi uỷ quyền đã bị `syncShop` nuốt thành
        // outcome FAILED ở nhánh trên, không rơi vào đây.
        await this.queue.requeue(shopId, POD_PRODUCT_SYNC_REQUEUE_DELAY_MS);
        this.logger.error({
          module: 'pod-product',
          operation: 'sync.due.fail',
          shopId,
          msg: error instanceof Error ? error.message : 'Lỗi không xác định',
        });
      }
    }

    return { shops: shopIds.length, failed };
  }

''' + anchor
s = s.replace(anchor, method, 1)

# DI queue
m = re.search(r"(  constructor\(\n)", s)
assert m, 'constructor'
s = s[: m.end(1)] + "    private readonly queue: PodProductSyncQueue,\n" + s[m.end(1):]

# imports
m = re.search(r"import \{([^}]*)\} from '\.\./constants/pod-product\.constants';", s)
assert m, 'constants import'
inner = m.group(1)
for name in ('POD_PRODUCT_SYNC_DUE_BATCH', 'POD_PRODUCT_SYNC_PUBLISH_DELAY_MS',
             'POD_PRODUCT_SYNC_PUBLISH_MAX_WAIT_MS', 'POD_PRODUCT_SYNC_REQUEUE_DELAY_MS'):
    if name not in inner:
        inner = '\n  ' + name + ',' + inner
s = s[: m.start(1)] + inner + s[m.end(1):]

anchor2 = re.search(r"^import .* from '\./pod-product-sync\.queue';\n", s, re.M)
if not anchor2:
    m2 = re.search(r"^import \{ PrismaService \} from '\.\./\.\./\.\./database/prisma\.service';\n", s, re.M)
    assert m2, 'prisma import anchor'
    s = s[: m2.end()] + "import { PodProductSyncQueue } from './pod-product-sync.queue';\n" + s[m2.end():]

io.open(p, 'w', encoding='utf-8').write(s)
print('ok sync service')
