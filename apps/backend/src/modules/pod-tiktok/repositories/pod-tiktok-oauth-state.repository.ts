import { Injectable } from '@nestjs/common';
import { PodTiktokOAuthStateStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

/** Bản ghi `state` sau khi tiêu thụ thành công — mang danh tính của phiên uỷ quyền. */
export interface ConsumedOAuthState {
  id: string;
  organizationId: string;
  userId: string;
  region: string;
  /** Tên kết nối người dùng đã nhập ở bước tạo link. */
  accountName: string;
}

/** Tóm tắt PHI NHẠY CẢM trả cho trang kết quả (công khai). KHÔNG có token. */
export interface OAuthStateResult {
  status: PodTiktokOAuthStateStatus;
  errorCode: string | null;
  usedAt: Date | null;
  account: {
    id: string;
    accountName: string;
    sellerName: string | null;
    shops: Array<{ name: string; region: string }>;
  } | null;
}

/**
 * PodTiktokOAuthStateRepository — vòng đời tham số `state` của luồng uỷ quyền TikTok.
 *
 * 🔴 Bảng này là nơi DUY NHẤT ánh xạ callback (request vô danh do TikTok chuyển hướng)
 * về đúng Organization/User ⇒ mọi thao tác tiêu thụ phải NGUYÊN TỬ và CHỈ MỘT LẦN.
 * Vì bản thân `state` là khoá tra cứu, các method ở đây KHÔNG nhận `organizationId`
 * — organization được ĐỌC RA từ bản ghi rồi mới dùng cho các bước sau (ADR-004).
 */
@Injectable()
export class PodTiktokOAuthStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    organizationId: string;
    userId: string;
    accountName: string;
    state: string;
    region: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.podTiktokOAuthState.create({ data });
  }

  /**
   * Tiêu thụ `state`: PENDING + còn hạn → USED. Trả về bản ghi nếu GIÀNH được, null nếu không.
   *
   * `updateMany` với đủ điều kiện trong MỆNH ĐỀ WHERE khiến việc kiểm tra và đánh dấu
   * xảy ra trong CÙNG một câu lệnh ⇒ hai callback đồng thời cùng một `state` thì chỉ một
   * cái nhận `count = 1`. Kiểm tra rồi mới update sẽ để lọt replay ở khe giữa hai bước.
   */
  async consume(state: string, now: Date): Promise<ConsumedOAuthState | null> {
    const { count } = await this.prisma.podTiktokOAuthState.updateMany({
      where: { state, status: PodTiktokOAuthStateStatus.PENDING, expiresAt: { gt: now } },
      data: { status: PodTiktokOAuthStateStatus.USED, usedAt: now },
    });
    if (count === 0) return null;

    return this.prisma.podTiktokOAuthState.findUnique({
      where: { state },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        region: true,
        accountName: true,
      },
    });
  }

  /**
   * Đánh dấu EXPIRED cho state quá hạn mà chưa ai dùng — để lần tra cứu sau biết
   * "đã hết hạn" chứ không phải "chưa từng tồn tại".
   * Trả về TRUE nếu bản ghi tồn tại (dù ở trạng thái nào) — chỉ dùng cho log.
   */
  async markExpiredIfPending(state: string, now: Date): Promise<boolean> {
    const existing = await this.prisma.podTiktokOAuthState.findUnique({
      where: { state },
      select: { id: true, status: true, expiresAt: true },
    });
    if (!existing) return false;

    if (existing.status === PodTiktokOAuthStateStatus.PENDING && existing.expiresAt <= now) {
      await this.prisma.podTiktokOAuthState.update({
        where: { id: existing.id },
        data: { status: PodTiktokOAuthStateStatus.EXPIRED },
      });
    }
    return true;
  }

  /** Luồng thành công: gắn kết nối vừa tạo/cập nhật + vé đọc kết quả. */
  async markSucceeded(id: string, accountId: string, resultToken: string): Promise<void> {
    await this.prisma.podTiktokOAuthState.update({
      where: { id },
      data: { accountId, resultToken, status: PodTiktokOAuthStateStatus.USED },
    });
  }

  /** Luồng lỗi: giữ lại mã lỗi nghiệp vụ để trang thất bại hiển thị nguyên nhân. */
  async markFailed(id: string, errorCode: string, resultToken: string): Promise<void> {
    await this.prisma.podTiktokOAuthState.update({
      where: { id },
      data: { errorCode, resultToken, status: PodTiktokOAuthStateStatus.FAILED },
    });
  }

  /** Đọc kết quả qua vé một lần (trang công khai). Chỉ trả dữ liệu phi nhạy cảm. */
  async findResultByToken(resultToken: string): Promise<OAuthStateResult | null> {
    const row = await this.prisma.podTiktokOAuthState.findUnique({
      where: { resultToken },
      select: {
        status: true,
        errorCode: true,
        usedAt: true,
        account: {
          select: {
            id: true,
            accountName: true,
            sellerName: true,
            shops: {
              where: { deletedAt: null },
              select: { name: true, region: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });
    return row ?? null;
  }

  /**
   * Dọn bản ghi đã quá thời gian lưu giữ. Đây là dữ liệu bảo mật tạm thời, không
   * phải dữ liệu nghiệp vụ ⇒ xoá cứng, không soft delete.
   */
  async purgeOlderThan(threshold: Date): Promise<number> {
    const { count } = await this.prisma.podTiktokOAuthState.deleteMany({
      where: { createdAt: { lt: threshold } },
    });
    return count;
  }
}
