import io, re, sys
sys.stdout.reconfigure(encoding='utf-8')

BE = '../backend/src/modules/pod-tiktok'

# ---------------------------------------------------------------- DTO
p = f'{BE}/dto/pod-order-response.dto.ts'
s = io.open(p, encoding='utf-8').read()
old = """  @ApiProperty({ description: 'Tên kết nối do người vận hành đặt' }) connectionName!: string;
  @ApiProperty({ nullable: true, type: String }) shopName!: string | null;
  /**
   * Nhà cung cấp fulfillment gán cho kết nối TikTok của đơn."""
new = """  @ApiProperty({ description: 'Tên kết nối do người vận hành đặt' }) connectionName!: string;
  @ApiProperty({ nullable: true, type: String }) shopName!: string | null;
  /**
   * Kết nối TikTok sở hữu đơn — để giao diện mở thẳng trang kết nối.
   *
   * 🔴 Trước đây trường này KHÔNG được trả về, nên frontend phải tra ngược `shopName` trong
   * danh sách kết nối đã tải sẵn. Cách đó đi sai kết nối ngay khi hai kết nối trỏ tới hai
   * gian hàng trùng tên — chuyện hoàn toàn có thật. `account` đã nằm trong include của
   * truy vấn danh sách nên trả thêm id không tốn thêm truy vấn nào.
   */
  @ApiProperty() accountId!: string;
  /**
   * Nhà cung cấp fulfillment gán cho kết nối TikTok của đơn."""
assert old in s, 'dto accountId'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok dto')

# ---------------------------------------------------------------- mapper
p = f'{BE}/mappers/pod-order-response.mapper.ts'
s = io.open(p, encoding='utf-8').read()
old = """      connectionName: order.account.accountName,
      shopName: order.shop.name,"""
new = """      connectionName: order.account.accountName,
      shopName: order.shop.name,
      accountId: order.account.id,"""
assert old in s, 'mapper accountId'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok mapper')

# ---------------------------------------------------------------- FE type
p = 'features/pod-tiktok/order-types.ts'
s = io.open(p, encoding='utf-8').read()
old = """  /** Tên gian hàng TikTok trả về — giữ để đối chiếu với Seller Center. */
  shopName: string | null;"""
new = """  /** Tên gian hàng TikTok trả về — giữ để đối chiếu với Seller Center. */
  shopName: string | null;
  /** Kết nối TikTok sở hữu đơn — dùng để mở thẳng trang kết nối. */
  accountId: string;"""
assert old in s, 'fe type accountId'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok fe type')

# ---------------------------------------------------------------- table: bỏ hack tra tên
p = 'features/pod-tiktok/components/pod-order-table.tsx'
s = io.open(p, encoding='utf-8').read()
s = s.replace("""  const accountIdOf = (order: PodOrderListItem): string | undefined =>
    order.shopName ? accountIdByShopName.get(order.shopName) : undefined;

""", "")
s = s.replace("accountId={accountIdOf(order)}", "accountId={order.accountId}")
s = re.sub(r"[ \t]*/\*\* Map `shopName` → id kết nối TikTok.*?\n[ \t]*accountIdByShopName: Map<string, string>;\n", "", s, flags=re.S)
s = s.replace("  accountIdByShopName,\n", "")
io.open(p, 'w', encoding='utf-8').write(s)
print('ok table')

# ---------------------------------------------------------------- page: bỏ map tra ngược
p = 'app/(dashboard)/dashboard/pod/orders/page.tsx'
s = io.open(p, encoding='utf-8').read()
s = re.sub(r"[ \t]*/\*\*\n[ \t]*\* `shopName` → id kết nối TikTok\..*?\n[ \t]*\}, \[accountsQuery\.data\]\);\n", "", s, flags=re.S)
s = s.replace("                accountIdByShopName={accountIdByShopName}\n", "")
io.open(p, 'w', encoding='utf-8').write(s)
print('ok page')
