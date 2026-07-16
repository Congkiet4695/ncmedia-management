import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './services/profile.service';

/**
 * ProfileModule — Self Service (xem/cập nhật hồ sơ, đổi mật khẩu của chính mình).
 * Import AuthModule để dùng JwtAuthGuard + tái sử dụng UserService (đã export).
 * PrismaService lấy từ PrismaModule (@Global).
 */
@Module({
  imports: [AuthModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
