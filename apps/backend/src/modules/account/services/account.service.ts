import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { EncryptionService } from '../../../common/services/encryption.service';
import { ACCOUNT_CREDENTIAL_FIELDS } from '../constants/account.constants';
import { CreateAccountDto } from '../dto/create-account.dto';
import { UpdateAccountDto } from '../dto/update-account.dto';
import { AssignSellerDto } from '../dto/assign-seller.dto';
import { AccountQueryDto } from '../dto/account-query.dto';
import { CredentialsInputDto } from '../dto/credentials-input.dto';
import {
  AccountGroupCountDto,
  AccountOverviewDto,
  AccountResponseDto,
  CredentialsResponseDto,
  PaginatedAccountResponseDto,
  SellerOptionDto,
} from '../dto/account-response.dto';
import {
  AccountNotFoundException,
  PlatformInvalidException,
  SellerInvalidException,
} from '../exceptions/account.exceptions';
import { AccountMapper } from '../mappers/account.mapper';
import { AccountRepository, AccountWriteData } from '../repositories/account.repository';

type CipherMap = Partial<Record<(typeof ACCOUNT_CREDENTIAL_FIELDS)[number], string | null>>;

/** Metadata request cho audit reveal. */
export interface RevealMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AccountRepository,
    private readonly mapper: AccountMapper,
    private readonly encryption: EncryptionService,
  ) {}

  async create(
    organizationId: string,
    actorUserId: string,
    dto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    await this.validatePlatformAndSeller(organizationId, dto.platformId, dto.sellerUserId);

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const account = await this.repo.create(
          tx,
          organizationId,
          actorUserId,
          this.buildWriteData(dto),
        );
        if (dto.credentials) {
          const cipher = this.encryptCredentials(dto.credentials);
          if (Object.keys(cipher).length > 0) {
            await this.repo.upsertCredential(tx, account.id, cipher, actorUserId);
          }
        }
        return account.id;
      });
      return this.findOne(organizationId, id);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  async findAll(
    organizationId: string,
    query: AccountQueryDto,
    sellerScope?: string,
  ): Promise<PaginatedAccountResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.repo.findMany(
      organizationId,
      {
        page,
        limit,
        search: query.search,
        platformId: query.platformId,
        status: query.status,
        sellerUserId: query.sellerUserId,
        issuedFrom: query.issuedFrom ? new Date(query.issuedFrom) : undefined,
        issuedTo: query.issuedTo ? new Date(query.issuedTo) : undefined,
        sortBy: query.sortBy ?? 'createdAt',
        sortOrder: query.sortOrder ?? 'desc',
      },
      sellerScope,
    );
    return {
      items: items.map((a) => this.mapper.toListItem(a)),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  async findOne(
    organizationId: string,
    id: string,
    sellerScope?: string,
  ): Promise<AccountResponseDto> {
    const account = await this.repo.findById(organizationId, id, sellerScope);
    if (!account) throw new AccountNotFoundException();
    return this.mapper.toResponse(account);
  }

  async update(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: UpdateAccountDto,
    sellerScope?: string,
  ): Promise<AccountResponseDto> {
    const existing = await this.repo.findById(organizationId, id, sellerScope);
    if (!existing) throw new AccountNotFoundException();
    await this.validatePlatformAndSeller(organizationId, dto.platformId, dto.sellerUserId);

    try {
      await this.prisma.$transaction((tx) =>
        this.repo.update(tx, existing.id, actorUserId, this.buildWriteData(dto)),
      );
    } catch (err) {
      throw this.mapWriteError(err);
    }
    return this.findOne(organizationId, id, sellerScope);
  }

  /** Gán/đổi Seller — chỉ Admin (permission account.assign). Xem toàn Org (không sellerScope). */
  async assignSeller(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: AssignSellerDto,
  ): Promise<AccountResponseDto> {
    const existing = await this.repo.findById(organizationId, id);
    if (!existing) throw new AccountNotFoundException();
    if (dto.sellerUserId) {
      const ok = await this.repo.sellerExistsInOrg(organizationId, dto.sellerUserId);
      if (!ok) throw new SellerInvalidException();
    }
    await this.repo.assignSeller(existing.id, dto.sellerUserId ?? null, actorUserId);
    return this.findOne(organizationId, id);
  }

  async remove(
    organizationId: string,
    actorUserId: string,
    id: string,
    sellerScope?: string,
  ): Promise<void> {
    const existing = await this.repo.findById(organizationId, id, sellerScope);
    if (!existing) throw new AccountNotFoundException();
    await this.repo.softDelete(existing.id, actorUserId);
  }

  /** Reveal credentials (giải mã) — ghi audit mỗi lần (BR-A12). Không log secret. */
  async revealCredentials(
    organizationId: string,
    actorUserId: string,
    id: string,
    meta: RevealMeta,
    sellerScope?: string,
  ): Promise<CredentialsResponseDto> {
    const existing = await this.repo.findById(organizationId, id, sellerScope);
    if (!existing) throw new AccountNotFoundException();

    await this.repo.insertAccessLog({
      organizationId,
      accountId: existing.id,
      accessedBy: actorUserId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    this.logger.warn(`Account credentials revealed account=${existing.id} by=${actorUserId}`);

    const raw = await this.repo.getCredentialRaw(existing.id);
    return {
      inf: this.encryption.decryptOptional(raw?.inf),
      ssn: this.encryption.decryptOptional(raw?.ssn),
      phoneReg: this.encryption.decryptOptional(raw?.phoneReg),
      gmail: this.encryption.decryptOptional(raw?.gmail),
      gmailPassword: this.encryption.decryptOptional(raw?.gmailPassword),
      recoveryMail: this.encryption.decryptOptional(raw?.recoveryMail),
      recoveryMail2fa: this.encryption.decryptOptional(raw?.recoveryMail2fa),
      platformPassword: this.encryption.decryptOptional(raw?.platformPassword),
      platform2faSecret: this.encryption.decryptOptional(raw?.platform2faSecret),
    };
  }

  async updateCredentials(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: CredentialsInputDto,
    sellerScope?: string,
  ): Promise<AccountResponseDto> {
    const existing = await this.repo.findById(organizationId, id, sellerScope);
    if (!existing) throw new AccountNotFoundException();
    const cipher = this.encryptCredentials(dto);
    await this.prisma.$transaction((tx) =>
      this.repo.upsertCredential(tx, existing.id, cipher, actorUserId),
    );
    return this.findOne(organizationId, id, sellerScope);
  }

  async listSellers(organizationId: string): Promise<SellerOptionDto[]> {
    const users = await this.repo.listSellers(organizationId);
    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.role.displayName,
    }));
  }

  async overview(organizationId: string, sellerScope?: string): Promise<AccountOverviewDto> {
    const rows = await this.repo.overviewRows(organizationId, sellerScope);
    const byStatus = { live: 0, dieTrang: 0, die: 0, total: rows.length };
    const sellerMap = new Map<string, AccountGroupCountDto>();
    const platformMap = new Map<string, AccountGroupCountDto>();

    const bump = (g: AccountGroupCountDto, status: AccountStatus): void => {
      if (status === AccountStatus.LIVE) g.live++;
      else if (status === AccountStatus.DIE_TRANG) g.dieTrang++;
      else if (status === AccountStatus.DIE) g.die++;
      g.total++;
    };

    for (const r of rows) {
      bump(byStatus as unknown as AccountGroupCountDto, r.status);

      const sKey = r.sellerUserId ?? '__none__';
      const s =
        sellerMap.get(sKey) ??
        this.newGroup(r.sellerUserId, r.sellerName ?? 'Chưa gán');
      bump(s, r.status);
      sellerMap.set(sKey, s);

      const pKey = r.platformId ?? '__none__';
      const p =
        platformMap.get(pKey) ??
        this.newGroup(r.platformId, r.platformName ?? 'Chưa gán');
      bump(p, r.status);
      platformMap.set(pKey, p);
    }

    return {
      total: rows.length,
      byStatus: { live: byStatus.live, dieTrang: byStatus.dieTrang, die: byStatus.die, total: byStatus.total },
      bySeller: [...sellerMap.values()],
      byPlatform: [...platformMap.values()],
    };
  }

  // --- helpers ---

  private newGroup(key: string | null, label: string): AccountGroupCountDto {
    return { key, label, live: 0, dieTrang: 0, die: 0, total: 0 };
  }

  private async validatePlatformAndSeller(
    organizationId: string,
    platformId?: string,
    sellerUserId?: string,
  ): Promise<void> {
    if (platformId && !(await this.repo.platformExists(platformId))) {
      throw new PlatformInvalidException();
    }
    if (sellerUserId && !(await this.repo.sellerExistsInOrg(organizationId, sellerUserId))) {
      throw new SellerInvalidException();
    }
  }

  private buildWriteData(dto: CreateAccountDto | UpdateAccountDto): AccountWriteData {
    return {
      name: dto.name,
      platformId: dto.platformId,
      loginTool: dto.loginTool,
      sellerUserId: dto.sellerUserId,
      status: dto.status,
      issuedAt: this.toDate(dto.issuedAt),
      activatedAt: this.toDate(dto.activatedAt),
      diedBlankAt: this.toDate(dto.diedBlankAt),
      diedAt: this.toDate(dto.diedAt),
      moneyReturnedAt: this.toDate(dto.moneyReturnedAt),
      dieReason: dto.dieReason,
      holdAmount: dto.holdAmount,
      netAmount: dto.netAmount,
      paidAmount: dto.paidAmount,
      proxy: dto.proxy,
      docsUrl: dto.docsUrl,
      note: dto.note,
      note2: dto.note2,
    };
  }

  private toDate(value?: string): Date | undefined {
    return value ? new Date(value) : undefined;
  }

  /** Mã hoá các field credential được cung cấp: có giá trị → ciphertext; '' → null; undefined → bỏ qua. */
  private encryptCredentials(input: CredentialsInputDto): CipherMap {
    const map: CipherMap = {};
    for (const field of ACCOUNT_CREDENTIAL_FIELDS) {
      const value = input[field];
      if (value !== undefined) {
        map[field] = value ? this.encryption.encrypt(value) : null;
      }
    }
    return map;
  }

  private mapWriteError(err: unknown): Error {
    return err instanceof Error ? err : new Error('Unknown error');
  }
}
