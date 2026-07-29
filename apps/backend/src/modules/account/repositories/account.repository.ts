import { Injectable } from '@nestjs/common';
import { AccountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AccountSortField, AccountCredentialField } from '../constants/account.constants';
import { ACCOUNT_INCLUDE, AccountWithRelations } from '../types/account-with-relations.type';

type CipherMap = Partial<Record<AccountCredentialField, string | null>>;

export interface AccountWriteData {
  name?: string;
  platformId?: string | null;
  loginTool?: string | null;
  sellerUserId?: string | null;
  status?: AccountStatus;
  issuedAt?: Date | null;
  activatedAt?: Date | null;
  diedBlankAt?: Date | null;
  diedAt?: Date | null;
  moneyReturnedAt?: Date | null;
  dieReason?: string | null;
  /** Hold/Net/Paid (USD) — NOT NULL default 0 ở DB, undefined = không đổi. */
  holdAmount?: number;
  netAmount?: number;
  paidAmount?: number;
  proxy?: string | null;
  docsUrl?: string | null;
  note?: string | null;
  note2?: string | null;
}

export interface AccountFindManyParams {
  page: number;
  limit: number;
  search?: string;
  platformId?: string;
  status?: AccountStatus;
  sellerUserId?: string;
  issuedFrom?: Date;
  issuedTo?: Date;
  sortBy: AccountSortField;
  sortOrder: 'asc' | 'desc';
}

export interface OverviewRow {
  status: AccountStatus;
  sellerUserId: string | null;
  sellerName: string | null;
  platformId: string | null;
  platformName: string | null;
}

/**
 * AccountRepository — data-access aggregate Account. Mọi query nhận `organizationId`
 * (tenant isolation — ADR-004) + optional `sellerScope` (row-level ownership — D-05).
 * KHÔNG mã hoá/giải mã (do service làm) — repo chỉ lưu/đọc ciphertext.
 */
@Injectable()
export class AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  platformExists(platformId: string): Promise<boolean> {
    return this.prisma.platform
      .count({ where: { id: platformId, isActive: true } })
      .then((c) => c > 0);
  }

  sellerExistsInOrg(organizationId: string, userId: string): Promise<boolean> {
    return this.prisma.user
      .count({ where: { id: userId, organizationId, deletedAt: null } })
      .then((c) => c > 0);
  }

  findById(
    organizationId: string,
    id: string,
    sellerScope?: string,
  ): Promise<AccountWithRelations | null> {
    return this.prisma.account.findFirst({
      where: {
        id,
        organizationId,
        deletedAt: null,
        ...(sellerScope ? { sellerUserId: sellerScope } : {}),
      },
      include: ACCOUNT_INCLUDE,
    });
  }

  create(
    tx: Prisma.TransactionClient,
    organizationId: string,
    actorUserId: string,
    data: AccountWriteData,
  ): Promise<{ id: string }> {
    return tx.account.create({
      data: {
        organizationId,
        name: data.name ?? '',
        platformId: data.platformId ?? null,
        loginTool: data.loginTool ?? null,
        sellerUserId: data.sellerUserId ?? null,
        status: data.status ?? AccountStatus.NEW,
        issuedAt: data.issuedAt ?? null,
        activatedAt: data.activatedAt ?? null,
        diedBlankAt: data.diedBlankAt ?? null,
        diedAt: data.diedAt ?? null,
        moneyReturnedAt: data.moneyReturnedAt ?? null,
        dieReason: data.dieReason ?? null,
        holdAmount: data.holdAmount ?? 0,
        netAmount: data.netAmount ?? 0,
        paidAmount: data.paidAmount ?? 0,
        proxy: data.proxy ?? null,
        docsUrl: data.docsUrl ?? null,
        note: data.note ?? null,
        note2: data.note2 ?? null,
        createdBy: actorUserId,
      },
      select: { id: true },
    });
  }

  async update(
    tx: Prisma.TransactionClient,
    id: string,
    actorUserId: string,
    data: AccountWriteData,
  ): Promise<void> {
    const patch: Prisma.AccountUpdateInput = { updatedBy: actorUserId };
    if (data.name !== undefined) patch.name = data.name;
    if (data.platformId !== undefined)
      patch.platform = data.platformId ? { connect: { id: data.platformId } } : { disconnect: true };
    if (data.loginTool !== undefined) patch.loginTool = data.loginTool;
    if (data.sellerUserId !== undefined)
      patch.seller = data.sellerUserId ? { connect: { id: data.sellerUserId } } : { disconnect: true };
    if (data.status !== undefined) patch.status = data.status;
    if (data.issuedAt !== undefined) patch.issuedAt = data.issuedAt;
    if (data.activatedAt !== undefined) patch.activatedAt = data.activatedAt;
    if (data.diedBlankAt !== undefined) patch.diedBlankAt = data.diedBlankAt;
    if (data.diedAt !== undefined) patch.diedAt = data.diedAt;
    if (data.moneyReturnedAt !== undefined) patch.moneyReturnedAt = data.moneyReturnedAt;
    if (data.dieReason !== undefined) patch.dieReason = data.dieReason;
    if (data.holdAmount !== undefined) patch.holdAmount = data.holdAmount;
    if (data.netAmount !== undefined) patch.netAmount = data.netAmount;
    if (data.paidAmount !== undefined) patch.paidAmount = data.paidAmount;
    if (data.proxy !== undefined) patch.proxy = data.proxy;
    if (data.docsUrl !== undefined) patch.docsUrl = data.docsUrl;
    if (data.note !== undefined) patch.note = data.note;
    if (data.note2 !== undefined) patch.note2 = data.note2;

    await tx.account.update({ where: { id }, data: patch });
  }

  async assignSeller(
    id: string,
    sellerUserId: string | null,
    actorUserId: string,
  ): Promise<void> {
    await this.prisma.account.update({
      where: { id },
      data: { sellerUserId, updatedBy: actorUserId },
    });
  }

  async softDelete(id: string, actorUserId: string): Promise<void> {
    await this.prisma.account.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actorUserId },
    });
  }

  /** Upsert credential (ciphertext). `cipher[field] === undefined` = giữ nguyên; null = xoá. */
  async upsertCredential(
    tx: Prisma.TransactionClient,
    accountId: string,
    cipher: CipherMap,
    actorUserId: string,
  ): Promise<void> {
    const data: Prisma.AccountCredentialUncheckedCreateInput = { accountId };
    const patch: Prisma.AccountCredentialUpdateInput = { updatedBy: actorUserId };
    (Object.keys(cipher) as AccountCredentialField[]).forEach((k) => {
      const v = cipher[k];
      if (v !== undefined) {
        (data as Record<string, unknown>)[k] = v;
        (patch as Record<string, unknown>)[k] = v;
      }
    });
    await tx.accountCredential.upsert({
      where: { accountId },
      create: { ...data, createdBy: actorUserId },
      update: patch,
    });
  }

  getCredentialRaw(accountId: string) {
    return this.prisma.accountCredential.findUnique({ where: { accountId } });
  }

  insertAccessLog(data: {
    organizationId: string;
    accountId: string;
    accessedBy: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<{ id: string }> {
    return this.prisma.accountCredentialAccessLog.create({
      data: {
        organizationId: data.organizationId,
        accountId: data.accountId,
        accessedBy: data.accessedBy,
        ipAddress: data.ipAddress?.slice(0, 45) ?? null,
        userAgent: data.userAgent?.slice(0, 512) ?? null,
      },
      select: { id: true },
    });
  }

  async findMany(
    organizationId: string,
    params: AccountFindManyParams,
    sellerScope?: string,
  ): Promise<{ items: AccountWithRelations[]; total: number }> {
    const where: Prisma.AccountWhereInput = {
      organizationId,
      deletedAt: null,
      ...(sellerScope ? { sellerUserId: sellerScope } : {}),
      ...(params.platformId ? { platformId: params.platformId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.sellerUserId ? { sellerUserId: params.sellerUserId } : {}),
      ...(params.issuedFrom || params.issuedTo
        ? {
            issuedAt: {
              ...(params.issuedFrom ? { gte: params.issuedFrom } : {}),
              ...(params.issuedTo ? { lte: params.issuedTo } : {}),
            },
          }
        : {}),
      ...(params.search
        ? { name: { contains: params.search, mode: 'insensitive' } }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.account.findMany({
        where,
        include: ACCOUNT_INCLUDE,
        orderBy: { [params.sortBy]: params.sortOrder },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.account.count({ where }),
    ]);
    return { items, total };
  }

  async overviewRows(organizationId: string, sellerScope?: string): Promise<OverviewRow[]> {
    const rows = await this.prisma.account.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(sellerScope ? { sellerUserId: sellerScope } : {}),
      },
      select: {
        status: true,
        sellerUserId: true,
        seller: { select: { fullName: true } },
        platformId: true,
        platform: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      status: r.status,
      sellerUserId: r.sellerUserId,
      sellerName: r.seller?.fullName ?? null,
      platformId: r.platformId,
      platformName: r.platform?.name ?? null,
    }));
  }

  listSellers(organizationId: string) {
    return this.prisma.user.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, fullName: true, email: true, role: { select: { displayName: true } } },
      orderBy: { fullName: 'asc' },
    });
  }
}
