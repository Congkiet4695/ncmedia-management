import { ConflictException } from '@nestjs/common';

/**
 * Email đã tồn tại (email global unique — Decision-001).
 * Trả code AUTH_EMAIL_EXISTS (auth.md Mục 18).
 */
export class EmailAlreadyExistsException extends ConflictException {
  constructor() {
    super({ code: 'AUTH_EMAIL_EXISTS', message: 'Email đã tồn tại' });
  }
}
