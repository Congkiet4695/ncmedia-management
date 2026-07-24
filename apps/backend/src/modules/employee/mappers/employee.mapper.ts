import { Injectable } from '@nestjs/common';
import { EmployeeListItemDto, EmployeeResponseDto } from '../dto/employee-response.dto';
import { EmployeeWithRelations } from '../types/employee-with-relations.type';

/** Chỉ lấy phần YYYY-MM-DD cho cột @db.Date. */
function toDateString(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * EmployeeMapper — Entity (Employee + User + Role) → Response DTO.
 * KHÔNG trả passwordHash / trường nhạy cảm của User.
 */
@Injectable()
export class EmployeeMapper {
  toResponse(employee: EmployeeWithRelations): EmployeeResponseDto {
    const { user } = employee;
    return {
      id: employee.id,
      fullName: user.fullName,
      email: user.email,
      status: employee.status,
      larkAccount: employee.larkAccount,
      startDate: toDateString(employee.startDate),
      resignedAt: toDateString(employee.resignedAt),
      cccd: employee.cccd,
      cccdImageUrl: employee.cccdImageUrl,
      phone: employee.phone,
      dateOfBirth: toDateString(employee.dateOfBirth),
      address: employee.address,
      department: employee.department,
      bankAccount: employee.bankAccount,
      bankQrUrl: employee.bankQrUrl,
      salary: Number(employee.salary),
      orderKpi: employee.orderKpi,
      revenueKpi: Number(employee.revenueKpi),
      avatar: employee.avatar,
      role: { id: user.role.id, code: user.role.code, name: user.role.displayName },
      createdAt: employee.createdAt.toISOString(),
      updatedAt: employee.updatedAt.toISOString(),
    };
  }

  toListItem(employee: EmployeeWithRelations): EmployeeListItemDto {
    const { user } = employee;
    return {
      id: employee.id,
      fullName: user.fullName,
      email: user.email,
      phone: employee.phone,
      department: employee.department,
      status: employee.status,
      startDate: toDateString(employee.startDate),
      resignedAt: toDateString(employee.resignedAt),
      avatar: employee.avatar,
      role: { id: user.role.id, code: user.role.code, name: user.role.displayName },
      createdAt: employee.createdAt.toISOString(),
    };
  }
}
