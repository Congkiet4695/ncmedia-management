import io, re, sys
sys.stdout.reconfigure(encoding='utf-8')

p = 'src/modules/pod-tiktok/services/pod-tiktok-account.service.ts'
s = io.open(p, encoding='utf-8').read()

# ---------------------------------------------------------------- 1) gán Seller khi TẠO MỚI
old = """        } else {
          const created = await this.repo.createAccount(tx, organizationId, actorUserId, writeData);
          accountId = created.id;
          action = PodTiktokTokenAction.ISSUE;
        }"""
new = """        } else {
          // 🔴 Kết nối MỚI do chính Seller liên kết ⇒ gán luôn cho họ. `PodAccessScopeService`
          // lọc theo `seller_id`, nên bỏ bước này thì Seller liên kết xong sẽ KHÔNG thấy gian
          // hàng, sản phẩm hay đơn của chính mình — chức năng coi như không dùng được.
          //
          // Chỉ áp dụng khi TẠO MỚI. Uỷ quyền lại (nhánh trên) giữ nguyên người phụ trách:
          // Admin đã phân công cho ai thì một lần re-authorize không được âm thầm đổi chủ.
          const sellerId = await this.repo.findSellerEmployeeIdByUser(organizationId, actorUserId);
          const created = await this.repo.createAccount(tx, organizationId, actorUserId, {
            ...writeData,
            sellerId,
          });
          accountId = created.id;
          action = PodTiktokTokenAction.ISSUE;
        }"""
assert old in s, 'persistLink create'
s = s.replace(old, new, 1)

# ---------------------------------------------------------------- 2) tự đồng bộ sản phẩm sau khi link
old = """    this.logger.log({
      module: 'pod-tiktok',
      operation: 'account.link',
      organizationId,
      accountId,
      shopCount: shops.length,
      msg: 'Đã liên kết TikTok Shop account',
    });

    return this.findOne(organizationId, accountId);"""
new = """    this.logger.log({
      module: 'pod-tiktok',
      operation: 'account.link',
      organizationId,
      accountId,
      shopCount: shops.length,
      msg: 'Đã liên kết TikTok Shop account',
    });

    this.startInitialProductSync(organizationId, accountId);

    return this.findOne(organizationId, accountId);"""
assert old in s, 'completeAuthorization log'
s = s.replace(old, new, 1)

# ---------------------------------------------------------------- 3) method + DI
anchor = """  /** Bước 3 — ghi DB nguyên tử: kết nối + shop + audit. */"""
assert anchor in s
method = '''  /**
   * Đồng bộ sản phẩm lần đầu ngay sau khi liên kết — **chạy nền, không chờ**.
   *
   * 🔴 KHÔNG `await`. Lời gọi này nằm trên đường OAuth callback: TikTok chuyển hướng trình
   * duyệt về đây và chờ một response. Một shop 100 sản phẩm là hơn 100 lời gọi TikTok — đủ
   * để callback hết giờ và người dùng thấy trang lỗi trong khi liên kết ĐÃ thành công.
   * Kết quả đồng bộ được ghi vào `pod_product_sync_histories`, màn hình Sync History đọc ở đó.
   *
   * 🔴 Lỗi ở đây KHÔNG được làm hỏng việc liên kết. Token đã lưu, shop đã ghi — đó mới là
   * thứ người dùng vừa làm. Sản phẩm chưa về được thì lượt đồng bộ theo lịch sẽ lấy tiếp.
   *
   * Dùng ĐÚNG `PodProductSyncService` mà scheduler và nút Sync thủ công đang dùng (qua token
   * `PRODUCT_SYNC_TRIGGER`) — không có logic đồng bộ thứ hai.
   */
  private startInitialProductSync(organizationId: string, accountId: string): void {
    if (!this.productSync) {
      // Không có cầu nối (vd test dựng module tối giản) ⇒ bỏ qua, liên kết vẫn thành công.
      return;
    }

    void this.productSync
      .syncShops({ organizationId, accountId }, { trigger: 'MANUAL' })
      .then(() => {
        this.logger.log({
          module: 'pod-tiktok',
          operation: 'account.link.initial-sync',
          organizationId,
          accountId,
          msg: 'Đã chạy đồng bộ sản phẩm lần đầu sau khi liên kết',
        });
      })
      .catch((error: unknown) => {
        this.logger.error({
          module: 'pod-tiktok',
          operation: 'account.link.initial-sync.fail',
          organizationId,
          accountId,
          msg: error instanceof Error ? error.message : 'Lỗi không xác định',
        });
      });
  }

''' + anchor
s = s.replace(anchor, method, 1)

# DI: @Optional() @Inject(PRODUCT_SYNC_TRIGGER)
m = re.search(r"(  constructor\(\n)", s)
assert m, 'constructor'
s = s[: m.end(1)] + (
    "    @Optional()\n"
    "    @Inject(PRODUCT_SYNC_TRIGGER)\n"
    "    private readonly productSync: ProductSyncTrigger | null,\n"
) + s[m.end(1):]

# imports
m = re.search(r"import \{([^}]*)\} from '@nestjs/common';", s)
assert m, 'nest import'
inner = m.group(1)
for name in ('Inject', 'Optional'):
    if name not in inner:
        inner = inner.rstrip().rstrip(',') + f', {name}'
s = s[: m.start(1)] + inner + s[m.end(1):]

anchor2 = re.search(r"^import .* from '\.\./repositories/pod-tiktok-account\.repository';\n", s, re.M)
assert anchor2, 'repo import'
s = s[: anchor2.end()] + (
    "import {\n"
    "  PRODUCT_SYNC_TRIGGER,\n"
    "  type ProductSyncTrigger,\n"
    "} from '../shared/product-sync-trigger';\n"
) + s[anchor2.end():]

io.open(p, 'w', encoding='utf-8').write(s)
print('ok account service')
