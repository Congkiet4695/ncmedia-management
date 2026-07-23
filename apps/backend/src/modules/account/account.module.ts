import { Module } from '@nestjs/common';
import { EncryptionService } from '../../common/services/encryption.service';
import { AuthModule } from '../auth/auth.module';
import { AccountController } from './account.controller';
import { AccountMapper } from './mappers/account.mapper';
import { AccountRepository } from './repositories/account.repository';
import { AccountExcelService } from './services/account-excel.service';
import { AccountService } from './services/account.service';

/**
 * AccountModule — quản lý Account (ShopAccount). Import AuthModule (JwtAuthGuard + PermissionsGuard).
 * EncryptionService (AES-256-GCM) cho secret at-rest.
 */
@Module({
  imports: [AuthModule],
  controllers: [AccountController],
  providers: [AccountService, AccountRepository, AccountMapper, AccountExcelService, EncryptionService],
})
export class AccountModule {}
