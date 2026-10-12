import { NotFoundException } from '@nestjs/common';

/** Yêu cầu không tồn tại TRONG tổ chức / phạm vi shop của người dùng (không tiết lộ là có ở nơi khác). */
export class PodReturnNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_RETURN_NOT_FOUND', message: 'Không tìm thấy yêu cầu Return/Refund.' });
  }
}
