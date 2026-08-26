import { Injectable, Logger } from '@nestjs/common';
import { FulfillmentAutoMapStatus, FulfillmentProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AUTO_MAP } from '../constants/auto-map.constants';
import { FulfillmentCatalogRepository } from '../repositories/fulfillment-catalog.repository';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import {
  findAutoMapCandidates,
  type AutoMapCandidate,
  type AutoMapVariantRow,
} from '../shared/auto-map-match';
import { mappingKeyOf } from '../shared/mapping-match';

/** Kết quả một lượt rà ánh xạ tự động. */
export interface AutoMapRunResult {
  /** Số cặp (Product ID + Seller SKU) chưa có ánh xạ được đem đi rà. */
  scanned: number;
  autoMapped: number;
  needManual: number;
  notFound: number;
  skipped: number;
}

/** Một dòng hàng chưa ánh xạ, đã gom theo cặp khoá. */
interface UnmappedKey {
  tiktokProductId: string;
  sellerSku: string;
  productName: string | null;
  skuName: string | null;
  productCategory: string | null;
  /** Tài khoản nhà cung cấp gán cho kết nối TikTok của đơn. */
  accountId: string;
  provider: FulfillmentProvider;
}

/**
 * ProductMappingAutoService — tự khai Product Mapping khi tìm được dữ liệu chắc chắn.
 *
 * ```
 *   Đơn TikTok đồng bộ về
 *        │
 *        ├─ Kết nối TikTok đã gán nhà cung cấp?  ── không ─▶ SKIPPED
 *        │
 *        ├─ Đã có Product Mapping?               ── có ────▶ bỏ qua
 *        │
 *        ▼
 *   Tra bản sao danh mục nhà cung cấp
 *        │  Seller SKU → Product Title → Variant → Catalogue
 *        │
 *        ├─ đúng 1 kết quả  ─▶ TẠO Product Mapping        (AUTO_MAPPED)
 *        ├─ nhiều kết quả   ─▶ KHÔNG tạo, lưu ứng viên    (NEED_MANUAL)
 *        └─ không kết quả   ─▶ KHÔNG tạo                  (NOT_FOUND)
 * ```
 *
 * 🔴 **Không được auto mapping sai.** Nhiều ứng viên thì hệ thống DỪNG LẠI, không "chọn cái
 * đầu tiên" và không chấm điểm để chọn cái giống nhất. Ánh xạ sai nghĩa là đơn ra xưởng in
 * với SKU của sản phẩm khác — hàng thật, tiền thật, và không ai phát hiện cho tới khi khách
 * nhận nhầm hàng. Một phút chọn tay rẻ hơn nhiều so với một lô hàng in sai.
 *
 * 🔴 Đọc từ **bản sao danh mục trong Database**, không gọi Mango. Rà 155 dòng hàng mà mỗi
 * dòng một lời gọi API thì lượt đồng bộ đơn sẽ mất hàng phút và hỏng ngay khi nhà cung cấp lỗi.
 *
 * 🔴 Danh mục chưa đồng bộ lần nào ⇒ **SKIPPED**, không phải NOT_FOUND. Hai thứ khác hẳn
 * nhau: một cái là "chưa có gì để tra", cái kia là "đã tra và không có". Nhập chúng lại sẽ
 * khiến người vận hành đi tìm sản phẩm trong một danh mục rỗng.
 */
@Injectable()
export class ProductMappingAutoService {
  private readonly logger = new Logger(ProductMappingAutoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: FulfillmentRepository,
    private readonly catalogRepo: FulfillmentCatalogRepository,
  ) {}

  /**
   * Rà mọi dòng hàng CHƯA có ánh xạ của một tổ chức.
   *
   * @param accountFilter Chỉ rà những dòng hàng thuộc một tài khoản nhà cung cấp cụ thể —
   *                      dùng ngay sau khi đồng bộ xong danh mục của tài khoản đó.
   */
  async resolveOrganization(
    organizationId: string,
    options: { accountFilter?: string; actorUserId?: string } = {},
  ): Promise<AutoMapRunResult> {
    const startedAt = Date.now();
    const keys = await this.loadUnmappedKeys(organizationId, options.accountFilter);

    const result: AutoMapRunResult = {
      scanned: keys.length,
      autoMapped: 0,
      needManual: 0,
      notFound: 0,
      skipped: 0,
    };
    if (keys.length === 0) return result;

    // Gom theo tài khoản: mỗi tài khoản chỉ nạp bản sao danh mục MỘT lần cho cả lượt rà.
    const byAccount = new Map<string, UnmappedKey[]>();
    for (const key of keys) {
      const list = byAccount.get(key.accountId) ?? [];
      list.push(key);
      byAccount.set(key.accountId, list);
    }

    const resolvedAt = new Date();
    const candidateRows: Parameters<FulfillmentCatalogRepository['upsertCandidates']>[2] = [];

    for (const [accountId, accountKeys] of byAccount) {
      const rows = (await this.catalogRepo.loadMatchIndexRows(
        organizationId,
        accountId,
      )) as AutoMapVariantRow[];

      // Danh mục rỗng ⇒ chưa đồng bộ lần nào. Nói đúng tình trạng đó thay vì "không tìm thấy".
      if (rows.length === 0) {
        result.skipped += accountKeys.length;
        for (const key of accountKeys) {
          candidateRows.push({
            tiktokProductId: key.tiktokProductId,
            sellerSku: key.sellerSku,
            status: FulfillmentAutoMapStatus.SKIPPED,
            tier: null,
            candidateCount: 0,
            candidates: null,
            mappingId: null,
          });
        }
        continue;
      }

      for (const key of accountKeys) {
        const outcome = findAutoMapCandidates(
          {
            sellerSku: key.sellerSku,
            productName: key.productName,
            skuName: key.skuName,
            productCategory: key.productCategory,
          },
          rows,
        );

        if (outcome.candidates.length === 1) {
          const mappingId = await this.createMapping(
            organizationId,
            key,
            outcome.candidates[0],
            outcome.tier,
            options.actorUserId,
          );
          result.autoMapped += 1;
          candidateRows.push({
            tiktokProductId: key.tiktokProductId,
            sellerSku: key.sellerSku,
            status: FulfillmentAutoMapStatus.AUTO_MAPPED,
            tier: outcome.tier,
            candidateCount: 1,
            candidates: this.trimCandidates(outcome.candidates),
            mappingId,
          });
          continue;
        }

        if (outcome.candidates.length > 1) {
          result.needManual += 1;
          candidateRows.push({
            tiktokProductId: key.tiktokProductId,
            sellerSku: key.sellerSku,
            status: FulfillmentAutoMapStatus.NEED_MANUAL,
            tier: outcome.tier,
            candidateCount: outcome.candidates.length,
            candidates: this.trimCandidates(outcome.candidates),
            mappingId: null,
          });
          continue;
        }

        result.notFound += 1;
        candidateRows.push({
          tiktokProductId: key.tiktokProductId,
          sellerSku: key.sellerSku,
          status: FulfillmentAutoMapStatus.NOT_FOUND,
          tier: null,
          candidateCount: 0,
          candidates: null,
          mappingId: null,
        });
      }

      await this.catalogRepo.upsertCandidates(
        organizationId,
        accountId,
        candidateRows.splice(0),
        resolvedAt,
      );
    }

    this.logger.log({
      module: 'fulfillment',
      operation: 'automap.resolve',
      organizationId,
      ...result,
      durationMs: Date.now() - startedAt,
      msg:
        `Ánh xạ tự động: rà ${result.scanned} sản phẩm — ${result.autoMapped} tự ánh xạ, ` +
        `${result.needManual} cần chọn tay, ${result.notFound} không tìm thấy, ` +
        `${result.skipped} bỏ qua`,
    });

    return result;
  }

  /** Rà mọi tổ chức — dùng cho scheduler. Lỗi một tổ chức không chặn tổ chức khác. */
  async resolveAll(): Promise<{ organizations: number; autoMapped: number }> {
    const orgs = await this.prisma.fulfillmentAccount.findMany({
      where: { deletedAt: null, isActive: true },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });

    let autoMapped = 0;
    for (const org of orgs) {
      try {
        const result = await this.resolveOrganization(org.organizationId);
        autoMapped += result.autoMapped;
      } catch (error) {
        this.logger.error({
          module: 'fulfillment',
          operation: 'automap.resolve',
          organizationId: org.organizationId,
          msg: `Rà ánh xạ tự động thất bại: ${(error as Error).message}`,
        });
      }
    }

    return { organizations: orgs.length, autoMapped };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Các cặp (Product ID + Seller SKU) CHƯA có ánh xạ, kèm tài khoản nhà cung cấp của đơn.
   *
   * 🔴 MỘT truy vấn cho cả tổ chức. Gom ở tầng DATABASE (`DISTINCT ON`) thay vì tải hết dòng
   * hàng rồi lọc trong bộ nhớ: một tổ chức chạy lâu có hàng chục nghìn dòng hàng nhưng chỉ
   * vài chục cặp khoá khác nhau.
   *
   * Nhà cung cấp lấy từ `pod_tiktok_accounts.fulfillment_account_id` — đúng chỗ mà luồng gửi
   * đơn cũng đọc, nên không thể lệch.
   */
  private loadUnmappedKeys(organizationId: string, accountFilter?: string): Promise<UnmappedKey[]> {
    return this.prisma.$queryRaw<UnmappedKey[]>`
      SELECT DISTINCT ON (i.product_id, i.seller_sku)
             i.product_id       AS "tiktokProductId",
             i.seller_sku       AS "sellerSku",
             i.product_name     AS "productName",
             i.sku_name         AS "skuName",
             i.product_category AS "productCategory",
             fa.id              AS "accountId",
             fa.provider        AS "provider"
      FROM pod_order_items i
      JOIN pod_orders o           ON o.id  = i.order_id
      JOIN pod_tiktok_accounts ta ON ta.id = o.account_id AND ta.deleted_at IS NULL
      JOIN fulfillment_accounts fa
        ON fa.id = ta.fulfillment_account_id
       AND fa.deleted_at IS NULL
       AND fa.is_active = true
      WHERE i.organization_id = ${organizationId}::uuid
        AND i.product_id  IS NOT NULL
        AND i.seller_sku  IS NOT NULL
        AND (${accountFilter ?? null}::uuid IS NULL OR fa.id = ${accountFilter ?? null}::uuid)
        AND NOT EXISTS (
          SELECT 1 FROM fulfillment_product_mappings m
          WHERE m.organization_id   = i.organization_id
            AND m.deleted_at        IS NULL
            AND m.tiktok_product_id = i.product_id
            AND m.seller_sku        = i.seller_sku
        )
      ORDER BY i.product_id, i.seller_sku, i.created_at DESC
      LIMIT ${AUTO_MAP.maxKeysPerRun}`;
  }

  /**
   * Tạo Product Mapping từ ứng viên DUY NHẤT tìm được.
   *
   * `note` mang dấu vết `[auto-map]` để phân biệt với ánh xạ do người khai — cần khi đối soát
   * chất lượng ánh xạ tự động và khi muốn gỡ hàng loạt lúc rollback.
   *
   * Chạy đua với một request khai tay cùng lúc là có thật (unique index trên cặp khoá sẽ từ
   * chối). Bắt đúng lỗi P2002 và coi như đã xong: ánh xạ đã tồn tại chính là kết quả mong muốn.
   */
  private async createMapping(
    organizationId: string,
    key: UnmappedKey,
    candidate: AutoMapCandidate,
    tier: string | null,
    actorUserId?: string,
  ): Promise<string | null> {
    try {
      const mapping = await this.prisma.fulfillmentProductMapping.create({
        data: {
          organizationId,
          accountId: key.accountId,
          provider: key.provider,
          tiktokProductId: key.tiktokProductId,
          sellerSku: key.sellerSku,
          providerSku: candidate.sku,
          providerProductId: candidate.externalProductId,
          providerVariantId: candidate.externalVariantId,
          providerProductName: candidate.productName,
          providerVariantName: candidate.variantName,
          isActive: true,
          note: `[auto-map] khớp theo ${tier ?? '?'} lúc đồng bộ`,
          createdBy: actorUserId ?? null,
          updatedBy: actorUserId ?? null,
        },
        select: { id: true },
      });

      this.logger.log({
        module: 'fulfillment',
        operation: 'automap.create',
        organizationId,
        mappingKey: mappingKeyOf(key.tiktokProductId, key.sellerSku),
        providerSku: candidate.sku,
        tier,
        msg: `Tự ánh xạ "${key.productName ?? key.sellerSku}" → ${candidate.sku}`,
      });

      return mapping.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Ai đó vừa khai tay đúng cặp khoá này. Không phải lỗi — kết quả đã đạt được.
        return null;
      }
      throw error;
    }
  }

  /** Chỉ giữ vài ứng viên hàng đầu: cột JSON này để gợi ý, không phải để lưu cả danh mục. */
  private trimCandidates(candidates: AutoMapCandidate[]): Prisma.InputJsonValue {
    return candidates.slice(0, AUTO_MAP.maxStoredCandidates) as unknown as Prisma.InputJsonValue;
  }
}
