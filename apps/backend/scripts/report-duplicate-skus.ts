/**
 * BÁO CÁO (chỉ đọc) Seller SKU trùng trong `pod_product_variants` — chạy TRƯỚC khi cân nhắc bất kỳ ràng
 * buộc UNIQUE nào trên Seller SKU. Không sửa / xoá dữ liệu.
 *
 *   1. Trùng TRONG một sản phẩm (nhiều biến thể cùng mã) — TikTok cho phép; POD hay dùng một mã cho mọi
 *      size/màu. Edit Product chỉ chặn trùng do LẦN SỬA tạo ra, không chặn trùng có sẵn.
 *   2. Trùng GIỮA các sản phẩm của cùng tổ chức — không luật nào trong hệ thống cấm.
 *
 * Chạy:
 *   node -r ts-node/register -r dotenv/config scripts/report-duplicate-skus.ts            # tổng hợp
 *   … --org <organizationId> --limit 50                                                  # chi tiết
 */
import { PrismaClient } from '@prisma/client';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const prisma = new PrismaClient();
  const organizationId = argValue('--org') ?? null;
  const limit = Number(argValue('--limit') ?? 20);
  try {
    const within = await prisma.$queryRaw<
      Array<{ organization_id: string; product_id: string; tiktok_product_id: string; title: string | null; seller_sku: string; variants: bigint }>
    >`
      SELECT v.organization_id, v.product_id, p.tiktok_product_id, p.title, v.seller_sku, COUNT(*)::bigint AS variants
        FROM pod_product_variants v
        JOIN pod_products p ON p.id = v.product_id AND p.deleted_at IS NULL
       WHERE v.deleted_at IS NULL AND COALESCE(TRIM(v.seller_sku), '') <> ''
         AND (${organizationId}::uuid IS NULL OR v.organization_id = ${organizationId}::uuid)
       GROUP BY v.organization_id, v.product_id, p.tiktok_product_id, p.title, v.seller_sku
      HAVING COUNT(*) > 1
       ORDER BY variants DESC`;
    const across = await prisma.$queryRaw<
      Array<{ organization_id: string; seller_sku: string; products: bigint; variants: bigint }>
    >`
      SELECT v.organization_id, v.seller_sku, COUNT(DISTINCT v.product_id)::bigint AS products, COUNT(*)::bigint AS variants
        FROM pod_product_variants v
        JOIN pod_products p ON p.id = v.product_id AND p.deleted_at IS NULL
       WHERE v.deleted_at IS NULL AND COALESCE(TRIM(v.seller_sku), '') <> ''
         AND (${organizationId}::uuid IS NULL OR v.organization_id = ${organizationId}::uuid)
       GROUP BY v.organization_id, v.seller_sku
      HAVING COUNT(DISTINCT v.product_id) > 1
       ORDER BY products DESC`;
    const [totals] = await prisma.$queryRaw<Array<{ products: bigint; variants: bigint }>>`
      SELECT COUNT(DISTINCT p.id)::bigint AS products, COUNT(v.id)::bigint AS variants
        FROM pod_products p JOIN pod_product_variants v ON v.product_id = p.id AND v.deleted_at IS NULL
       WHERE p.deleted_at IS NULL AND (${organizationId}::uuid IS NULL OR p.organization_id = ${organizationId}::uuid)`;

    const productsWithin = new Set(within.map((row) => row.product_id)).size;
    console.log(
      JSON.stringify(
        {
          scope: organizationId ?? 'ALL_ORGANIZATIONS',
          products: Number(totals.products),
          variants: Number(totals.variants),
          withinProduct: { products: productsWithin, groups: within.length },
          acrossProducts: { sellerSkus: across.length },
        },
        null,
        2,
      ),
    );
    console.log('\n— Trùng TRONG một sản phẩm (top):');
    for (const row of within.slice(0, limit)) {
      console.log(JSON.stringify({ ...row, variants: Number(row.variants), title: row.title?.slice(0, 60) ?? null }));
    }
    console.log('\n— Trùng GIỮA các sản phẩm (top):');
    for (const row of across.slice(0, limit)) {
      console.log(JSON.stringify({ ...row, products: Number(row.products), variants: Number(row.variants) }));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
