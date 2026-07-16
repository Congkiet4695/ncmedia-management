import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrderController } from './order.controller';
import { OrderMapper } from './mappers/order.mapper';
import { OrderRepository } from './repositories/order.repository';
import { OrderService } from './services/order.service';

/**
 * OrderModule — quản lý Order (đơn hàng nhập tay — ADR-012).
 * Import AuthModule (JwtAuthGuard + PermissionsGuard).
 */
@Module({
  imports: [AuthModule],
  controllers: [OrderController],
  providers: [OrderService, OrderRepository, OrderMapper],
})
export class OrderModule {}
