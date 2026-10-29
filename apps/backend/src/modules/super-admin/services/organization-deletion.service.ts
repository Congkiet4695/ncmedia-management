import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiErrorItem } from '../../../common/interfaces/api-response.interface';
import { PrismaService } from '../../../database/prisma.service';
import { RefreshTokenService } from '../../auth/services/refresh-token.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import {
  buildOrganizationDeletionPlan,
  TENANT_COLUMN,
  type OrganizationDeletionPlan,
} from '../constants/organization-deletion.plan';
import {
  ORGANIZATION_DELETE_LOCK_PREFIX,
  ORGANIZATION_DELETE_LOCK_TIMEOUT,
  ORGANIZATION_DELETE_TX_OPTIONS,
} from '../constants/super-admin.constants';
import type {
  DeleteOrganizationDto,
  OrganizationDeletionResultDto,
  OrganizationDeletionTableDto,
} from '../dto/super-admin-organization.dto';
import {
  OrganizationDeleteBusyException,
  OrganizationDeleteConfirmationMismatchException,
  OrganizationDeleteFailedException,
  OrganizationDeleteUnsafeException,
} from '../exceptions/organization-deletion.exceptions';
import { OrganizationNotFoundException } from './organization-review.service';

const STORAGE_FILES_TABLE = 'storage_files';

/** Tên bảng / cột lấy từ schema Prisma (không bao giờ từ request) — vẫn quote cho chắc. */
function ident(name: string): Prisma.Sql {
  return Prisma.raw(`"${name.replace(/"/g, '""')}"`);
}

/**
 * OrganizationDeletionService — Super Admin XOÁ CỨNG một Organization cùng toàn bộ dữ liệu của nó.
 *
 * ```
 *   Organization (không phải tổ chức hệ thống) + slug xác nhận khớp + kế hoạch xoá hợp lệ
 *     ↓ khoá Redis theo tổ chức (chống bấm lặp / hai Super Admin cùng xoá)
 *     ↓ MỘT transaction:
 *         SELECT organizations … FOR UPDATE
 *         (1) quét mọi bảng có cột organization_id — bảng NGOÀI kế hoạch mà có dữ liệu ⇒ TỪ CHỐI
 *         (2) dữ liệu tổ chức KHÁC tham chiếu vào dữ liệu tổ chức này ⇒ TỪ CHỐI (xoá sẽ lan sang họ)
 *         (3) DELETE … WHERE organization_id = :id theo đúng thứ tự kế hoạch (con trước cha)
 *         (4) kiểm lại: không bảng nào còn dòng của tổ chức ⇒ nếu còn: ROLLBACK
 *         (5) DELETE organizations
 *     ↓ dọn cache phiên (Redis) của các user vừa bị xoá — best effort
 * ```
 *
 * 🔴 Nguyên tắc: hoặc xoá TRỌN, hoặc KHÔNG xoá gì. Mọi lỗi (kể cả hết `lock_timeout` vì một tiến
 * trình nền đang ghi dữ liệu của tổ chức) ⇒ rollback toàn bộ và báo lỗi rõ ràng.
 *
 * 🔴 Không đụng tới: dữ liệu dùng chung (Platform, Permission, danh mục / thương hiệu TikTok, master
 * data sync), tài khoản fulfillment DÙNG CHUNG của Organization hệ thống (thuộc tổ chức khác, chỉ được
 * tham chiếu), và FILE VẬT LÝ trên kho lưu trữ — chỉ metadata `storage_files` bị xoá; dọn object theo
 * quy trình vận hành riêng (đếm trả về trong `storageFilesDeleted`).
 *
 * 🔴 Phiên đăng nhập của user bị xoá: refresh token nằm trong `refresh_tokens` (CASCADE theo users) ⇒
 * không xoay vòng được nữa. Access token còn hạn (≤ 15 phút) không gọi được API cần quyền vì
 * `PermissionsGuard` đọc quyền từ role trong DB — role đã bị xoá.
 */
@Injectable()
export class OrganizationDeletionService {
  private readonly logger = new Logger(OrganizationDeletionService.name);

  /** Dựng một lần từ schema đang chạy — kế hoạch lỗi ⇒ mọi lệnh xoá bị từ chối (không xoá dở). */
  private readonly plan: OrganizationDeletionPlan = buildOrganizationDeletionPlan(
    Prisma.dmmf.datamodel,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: DistributedLockService,
    private readonly refreshTokens: RefreshTokenService,
  ) {
    if (this.plan.problems.length > 0) {
      this.logger.error({
        module: 'super-admin',
        operation: 'organization.delete.plan',
        problems: this.plan.problems,
        msg: 'Kế hoạch xoá Organization KHÔNG hợp lệ — mọi lệnh xoá sẽ bị từ chối',
      });
    }
  }

  async delete(
    operator: AuthenticatedUser,
    id: string,
    dto: DeleteOrganizationDto,
  ): Promise<OrganizationDeletionResultDto> {
    // Tổ chức hệ thống (chứa Super Admin) không bao giờ lọt qua — y như mọi màn của Super Admin.
    const organization = await this.prisma.organization.findFirst({
      where: { id, isPlatform: false },
      select: { id: true, name: true, slug: true },
    });
    if (!organization) throw new OrganizationNotFoundException();
    if (dto.confirmSlug !== organization.slug)
      throw new OrganizationDeleteConfirmationMismatchException();
    if (this.plan.problems.length > 0) {
      throw new OrganizationDeleteUnsafeException(
        this.plan.problems.map((problem) => ({ field: 'deletion-plan', message: problem })),
      );
    }

    const lock = await this.locks.acquire(
      `${ORGANIZATION_DELETE_LOCK_PREFIX}${id}`,
      ORGANIZATION_DELETE_TX_OPTIONS.timeout,
    );
    if (!lock) throw new OrganizationDeleteBusyException();

    const startedAt = Date.now();
    let outcome: { tables: OrganizationDeletionTableDto[]; userIds: string[] };
    try {
      outcome = await this.prisma.$transaction(
        (tx) => this.deleteInTransaction(tx, id),
        ORGANIZATION_DELETE_TX_OPTIONS,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error({
        module: 'super-admin',
        operation: 'organization.delete.fail',
        organizationId: id,
        operatorId: operator.userId,
        msg: error instanceof Error ? error.message : 'Lỗi không xác định',
      });
      throw new OrganizationDeleteFailedException();
    } finally {
      await this.locks.release(lock);
    }

    for (const userId of outcome.userIds) await this.refreshTokens.dropCachedSessions(userId);

    const tables = outcome.tables.filter((row) => row.deleted > 0);
    const result: OrganizationDeletionResultDto = {
      organizationId: organization.id,
      name: organization.name,
      slug: organization.slug,
      deletedRows: tables.reduce((sum, row) => sum + row.deleted, 0),
      tables,
      storageFilesDeleted: tables.find((row) => row.table === STORAGE_FILES_TABLE)?.deleted ?? 0,
      durationMs: Date.now() - startedAt,
    };

    // Nhật ký vận hành của thao tác phá huỷ: ai, xoá tổ chức nào, bao nhiêu dòng — không dữ liệu nghiệp vụ.
    this.logger.warn({
      module: 'super-admin',
      operation: 'organization.delete',
      organizationId: result.organizationId,
      organizationSlug: result.slug,
      operatorId: operator.userId,
      deletedRows: result.deletedRows,
      tables: result.tables,
      storageFilesDeleted: result.storageFilesDeleted,
      durationMs: result.durationMs,
      msg: 'Đã XOÁ CỨNG Organization cùng toàn bộ dữ liệu',
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Transaction
  // ---------------------------------------------------------------------------

  private async deleteInTransaction(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ tables: OrganizationDeletionTableDto[]; userIds: string[] }> {
    await tx.$queryRaw(
      Prisma.sql`SELECT set_config('lock_timeout', ${ORGANIZATION_DELETE_LOCK_TIMEOUT}, true)`,
    );
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM organizations WHERE id = ${id}::uuid AND is_platform = false FOR UPDATE`);
    if (locked.length === 0) throw new OrganizationNotFoundException();

    const tenantTables = await this.tenantTables(tx);
    await this.assertNoUnknownTenantData(tx, id, tenantTables);
    await this.assertNoCrossTenantReferences(tx, id);

    const users = await tx.user.findMany({ where: { organizationId: id }, select: { id: true } });

    const tables: OrganizationDeletionTableDto[] = [];
    for (const step of this.plan.steps) {
      const deleted = await tx.$executeRaw(Prisma.sql`
        DELETE FROM ${ident(step.table)} WHERE ${ident(TENANT_COLUMN)} = ${id}::uuid`);
      tables.push({ table: step.table, deleted });
    }

    const leftovers = await this.tablesWithRows(tx, id, tenantTables);
    if (leftovers.length > 0) {
      throw new OrganizationDeleteUnsafeException(
        leftovers.map((table) => ({
          field: table,
          message: 'Vẫn còn dữ liệu của tổ chức sau khi xoá',
        })),
      );
    }

    await tx.$executeRaw(
      Prisma.sql`DELETE FROM organizations WHERE id = ${id}::uuid AND is_platform = false`,
    );
    return { tables, userIds: users.map((user) => user.id) };
  }

  /** Mọi bảng THẬT trong database có cột `organization_id` (không chỉ những bảng Prisma biết). */
  private async tenantTables(tx: Prisma.TransactionClient): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ table_name: string }>>(Prisma.sql`
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = current_schema()
         AND c.column_name = ${TENANT_COLUMN}
         AND t.table_type = 'BASE TABLE'`);
    return rows.map((row) => row.table_name);
  }

  /** Bảng nào (trong danh sách) còn dòng của tổ chức. */
  private async tablesWithRows(
    tx: Prisma.TransactionClient,
    id: string,
    tables: string[],
  ): Promise<string[]> {
    const found: string[] = [];
    for (const table of tables) {
      const [row] = await tx.$queryRaw<Array<{ found: boolean }>>(Prisma.sql`
        SELECT EXISTS (SELECT 1 FROM ${ident(table)} WHERE ${ident(TENANT_COLUMN)} = ${id}::uuid) AS found`);
      if (row?.found) found.push(table);
    }
    return found;
  }

  /** (1) Bảng có `organization_id` mà kế hoạch không biết ⇒ không rõ quyền sở hữu ⇒ không xoá. */
  private async assertNoUnknownTenantData(
    tx: Prisma.TransactionClient,
    id: string,
    tenantTables: string[],
  ): Promise<void> {
    const planned = new Set(this.plan.steps.map((step) => step.table));
    const unknown = tenantTables.filter((table) => !planned.has(table));
    const withData = await this.tablesWithRows(tx, id, unknown);
    if (withData.length > 0) {
      throw new OrganizationDeleteUnsafeException(
        withData.map((table) => ({
          field: table,
          message: 'Bảng có dữ liệu của tổ chức nhưng chưa nằm trong kế hoạch xoá',
        })),
      );
    }
  }

  /**
   * (2) Dòng của tổ chức KHÁC trỏ vào dòng của tổ chức này ⇒ CASCADE sẽ xoá dữ liệu của họ, SET NULL sẽ
   * sửa dữ liệu của họ, RESTRICT sẽ làm hỏng lệnh xoá. Cả ba đều không được phép ⇒ TỪ CHỐI.
   * Dòng KHÔNG thuộc tổ chức nào chỉ bị chặn khi quan hệ là CASCADE (SET NULL chỉ gỡ liên kết).
   */
  private async assertNoCrossTenantReferences(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    const violations: ApiErrorItem[] = [];
    for (const ref of this.plan.crossTenantReferences) {
      const foreignOwner = ref.cascades
        ? Prisma.sql`(c.${ident(TENANT_COLUMN)} IS DISTINCT FROM ${id}::uuid)`
        : Prisma.sql`(c.${ident(TENANT_COLUMN)} <> ${id}::uuid)`;
      const [row] = await tx.$queryRaw<Array<{ found: boolean }>>(Prisma.sql`
        SELECT EXISTS (
          SELECT 1
            FROM ${ident(ref.childTable)} c
            JOIN ${ident(ref.parentTable)} p ON p.${ident(ref.parentColumn)} = c.${ident(ref.childColumn)}
           WHERE p.${ident(TENANT_COLUMN)} = ${id}::uuid
             AND ${foreignOwner}
        ) AS found`);
      if (row?.found) {
        violations.push({
          field: `${ref.childTable}.${ref.childColumn} → ${ref.parentTable}`,
          message: 'Có dữ liệu không thuộc tổ chức này tham chiếu tới dữ liệu của tổ chức',
        });
      }
    }
    if (violations.length > 0) throw new OrganizationDeleteUnsafeException(violations);
  }
}
