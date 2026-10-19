import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { EncryptionService } from '../../../common/services/encryption.service';
import { UpdatePodTiktokAccountLoginInfoDto } from '../dto/pod-tiktok-query.dto';
import {
  PodTiktokAccountCredentialsDto,
  PodTiktokAccountResponseDto,
} from '../dto/pod-tiktok-response.dto';
import { PodTiktokAccountNotFoundException } from '../exceptions/pod-tiktok.exceptions';
import {
  PodTiktokAccountLoginInfoWriteData,
  PodTiktokAccountRepository,
} from '../repositories/pod-tiktok-account.repository';
import { parseCalendarDay } from '../shared/calendar-day';
import type { PodAccessScope } from './pod-access-scope.service';
import { PodTiktokAccountService, type PodTiktokRequestMeta } from './pod-tiktok-account.service';

/** Tên trường credential trong audit (không bao giờ kèm giá trị). */
const PASSWORD_FIELD = 'tiktokPassword';
const TWO_FACTOR_FIELD = 'tiktokTwoFactorCode';

/**
 * PodTiktokAccountInfoService — thông tin nhập tay của kết nối TikTok: Tiktok mail · Password tiktok · 2FA Code ·
 * Ngày về tiền.
 *
 * 🔴 Bảo mật credential (Password tiktok, 2FA Code):
 *  - Mã hoá AES-256-GCM bằng `EncryptionService` (khoá `ACCOUNT_ENCRYPTION_KEY` — cùng miền "credential tài khoản
 *    sàn" với module Account, docs/account.md D-01). Không hash: người vận hành cần đọc lại để đăng nhập.
 *  - List / detail chỉ trả cờ `hasTiktokPassword` / `hasTiktokTwoFactorCode`. Giá trị thật chỉ qua `reveal`
 *    (quyền riêng `pod.tiktok.account.credentials.read`), mỗi lần xem ghi một dòng audit.
 *  - Log / audit chỉ có TÊN trường — không bao giờ có giá trị (kể cả ciphertext).
 *  - Phạm vi: mọi thao tác đi qua `PodAccessScope` — người không có `pod.shop.all` chỉ chạm được kết nối được gán.
 */
@Injectable()
export class PodTiktokAccountInfoService {
  private readonly logger = new Logger(PodTiktokAccountInfoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PodTiktokAccountRepository,
    private readonly encryption: EncryptionService,
    private readonly accounts: PodTiktokAccountService,
  ) {}

  /**
   * Cập nhật thông tin nhập tay — MỘT request cho cả form, chỉ ghi các trường có mặt trong DTO.
   * `undefined` giữ nguyên ⇒ sửa Ngày về tiền không bao giờ xoá Password đã lưu.
   */
  async updateLoginInfo(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: UpdatePodTiktokAccountLoginInfoDto,
    scope: PodAccessScope,
    meta: PodTiktokRequestMeta = {},
  ): Promise<PodTiktokAccountResponseDto> {
    const account = await this.repo.findById(organizationId, id, this.accountScope(scope));
    if (!account) throw new PodTiktokAccountNotFoundException();

    const data: PodTiktokAccountLoginInfoWriteData = {};
    if (dto.tiktokMail !== undefined) data.tiktokMail = dto.tiktokMail;
    if (dto.tiktokPassword !== undefined) {
      data.tiktokPasswordEnc = this.encryption.encryptOptional(dto.tiktokPassword);
    }
    if (dto.tiktokTwoFactorCode !== undefined) {
      data.tiktokTwoFactorEnc = this.encryption.encryptOptional(dto.tiktokTwoFactorCode);
    }
    if (dto.moneyReturnDate !== undefined) {
      data.moneyReturnDate = dto.moneyReturnDate === null ? null : this.toCalendarDate(dto.moneyReturnDate);
    }

    const changedSecrets = [
      ...(dto.tiktokPassword !== undefined ? [PASSWORD_FIELD] : []),
      ...(dto.tiktokTwoFactorCode !== undefined ? [TWO_FACTOR_FIELD] : []),
    ];
    if (Object.keys(data).length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await this.repo.updateLoginInfo(tx, account.id, data, actorUserId);
        if (changedSecrets.length > 0) {
          await this.repo.insertCredentialAudit(tx, {
            organizationId,
            accountId: account.id,
            action: 'UPDATE',
            fields: changedSecrets,
            performedBy: actorUserId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          });
        }
      });
      this.logger.log({
        module: 'pod-tiktok',
        operation: 'account.update-login-info',
        organizationId,
        accountId: account.id,
        // Chỉ TÊN trường — không có giá trị.
        fields: Object.keys(dto).filter(
          (key) => dto[key as keyof UpdatePodTiktokAccountLoginInfoDto] !== undefined,
        ),
        msg: 'Đã cập nhật thông tin đăng nhập TikTok Account',
      });
    }
    return this.accounts.findOne(organizationId, account.id, scope);
  }

  /** Giải mã Password tiktok / 2FA Code để xem. Mỗi lần gọi ghi audit REVEAL (kể cả khi chưa lưu gì). */
  async revealCredentials(
    organizationId: string,
    actorUserId: string,
    id: string,
    scope: PodAccessScope,
    meta: PodTiktokRequestMeta = {},
  ): Promise<PodTiktokAccountCredentialsDto> {
    const account = await this.repo.findById(organizationId, id, this.accountScope(scope));
    if (!account) throw new PodTiktokAccountNotFoundException();

    await this.repo.insertCredentialAudit(this.prisma, {
      organizationId,
      accountId: account.id,
      action: 'REVEAL',
      fields: [PASSWORD_FIELD, TWO_FACTOR_FIELD],
      performedBy: actorUserId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    this.logger.warn({
      module: 'pod-tiktok',
      operation: 'account.reveal-credentials',
      organizationId,
      accountId: account.id,
      actorUserId,
      msg: 'Đã xem credential TikTok Account',
    });

    return {
      tiktokPassword: this.encryption.decryptOptional(account.tiktokPasswordEnc),
      tiktokTwoFactorCode: this.encryption.decryptOptional(account.tiktokTwoFactorEnc),
    };
  }

  private accountScope(scope: PodAccessScope): string[] | undefined {
    return scope.allShops ? undefined : scope.accountIds;
  }

  private toCalendarDate(day: string): Date {
    const date = parseCalendarDay(day);
    if (!date) {
      throw new BadRequestException({
        code: 'POD_TIKTOK_MONEY_RETURN_DATE_INVALID',
        message: 'Ngày về tiền không hợp lệ.',
      });
    }
    return date;
  }
}
