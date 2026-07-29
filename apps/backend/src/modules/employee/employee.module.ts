import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmployeeController } from './employee.controller';
import { EmployeeMapper } from './mappers/employee.mapper';
import { EmployeeRepository } from './repositories/employee.repository';
import { EmployeeExcelService } from './services/employee-excel.service';
import { EmployeeService } from './services/employee.service';

/**
 * EmployeeModule — module nghiệp vụ đầu tiên (Sprint 2).
 * Import AuthModule để dùng JwtAuthGuard + AdminGuard (đã export).
 */
@Module({
  imports: [AuthModule],
  controllers: [EmployeeController],
  providers: [EmployeeService, EmployeeExcelService, EmployeeRepository, EmployeeMapper],
})
export class EmployeeModule {}
