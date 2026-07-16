import { Injectable } from '@nestjs/common';
import { AccountListItemDto, AccountResponseDto } from '../dto/account-response.dto';
import { AccountWithRelations } from '../types/account-with-relations.type';

function toDateString(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Tuổi thọ (ngày) = diedAt − issuedAt. Derived, không lưu DB (BR-A08). */
function lifespanDays(issuedAt: Date | null, diedAt: Date | null): number | null {
  if (!issuedAt || !diedAt) return null;
  const ms = diedAt.getTime() - issuedAt.getTime();
  return ms >= 0 ? Math.round(ms / 86_400_000) : null;
}

/**
 * AccountMapper — Entity → Response DTO. KHÔNG bao giờ trả secret (credentials).
 */
@Injectable()
export class AccountMapper {
  toResponse(a: AccountWithRelations): AccountResponseDto {
    return {
      id: a.id,
      name: a.name,
      idNormalize: a.idNormalize,
      platform: a.platform ? { id: a.platform.id, code: a.platform.code, name: a.platform.name } : null,
      loginTool: a.loginTool,
      seller: a.seller
        ? { id: a.seller.id, fullName: a.seller.fullName, email: a.seller.email }
        : null,
      status: a.status,
      issuedAt: toDateString(a.issuedAt),
      activatedAt: toDateString(a.activatedAt),
      diedBlankAt: toDateString(a.diedBlankAt),
      diedAt: toDateString(a.diedAt),
      moneyReturnedAt: toDateString(a.moneyReturnedAt),
      dieReason: a.dieReason,
      lifespanDays: lifespanDays(a.issuedAt, a.diedAt),
      proxy: a.proxy,
      docsUrl: a.docsUrl,
      note: a.note,
      note2: a.note2,
      hasCredentials: a.credential != null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  }

  toListItem(a: AccountWithRelations): AccountListItemDto {
    return {
      id: a.id,
      name: a.name,
      platformName: a.platform?.name ?? null,
      sellerName: a.seller?.fullName ?? null,
      status: a.status,
      issuedAt: toDateString(a.issuedAt),
      diedAt: toDateString(a.diedAt),
      lifespanDays: lifespanDays(a.issuedAt, a.diedAt),
      hasCredentials: a.credential != null,
      createdAt: a.createdAt.toISOString(),
    };
  }
}
