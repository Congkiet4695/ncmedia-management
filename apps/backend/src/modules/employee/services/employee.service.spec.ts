import { Test, TestingModule } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CreateEmployeeDto } from '../dto/create-employee.dto';
import { EmployeeEmailExistsException } from '../exceptions/employee-email-exists.exception';
import { EmployeeNotFoundException } from '../exceptions/employee-not-found.exception';
import { EmployeeRoleInvalidException } from '../exceptions/employee-role-invalid.exception';
import { EmployeeMapper } from '../mappers/employee.mapper';
import { EmployeeRepository } from '../repositories/employee.repository';
import { EmployeeService } from './employee.service';

jest.mock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('$2b$12$hash') }));

/** Unit test — EmployeeService (Sprint 2). */
describe('EmployeeService', () => {
  let service: EmployeeService;

  const repo = {
    emailExists: jest.fn(),
    findRoleInOrg: jest.fn(),
    findRoleByCode: jest.fn(),
    findById: jest.fn(),
    findMany: jest.fn(),
    createWithUser: jest.fn(),
    updateWithUser: jest.fn(),
    updateUserPassword: jest.fn(),
    softDelete: jest.fn(),
  };
  // $transaction chạy callback với tx giả.
  const prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) };
  const mapper = new EmployeeMapper();

  const ORG = 'org-1';
  const ACTOR = 'admin-1';

  const employeeRow = {
    id: 'emp-1',
    userId: 'user-1',
    status: 'ACTIVE',
    larkAccount: null,
    startDate: null,
    resignedAt: null,
    cccd: null,
    cccdImageUrl: null,
    phone: null,
    dateOfBirth: null,
    address: null,
    department: null,
    bankAccount: null,
    bankQrUrl: null,
    avatar: null,
    salary: 0,
    orderKpi: 0,
    revenueKpi: 0,
    createdAt: new Date('2026-07-15T00:00:00Z'),
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    user: {
      fullName: 'Nguyen Van A',
      email: 'a@ncmedia.com',
      status: UserStatus.ACTIVE,
      role: { id: 'role-1', code: 'EMPLOYEE', displayName: 'Employee' },
    },
  };

  const createDto: CreateEmployeeDto = { fullName: 'Nguyen Van A', email: 'a@ncmedia.com' };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeeRepository, useValue: repo },
        { provide: EmployeeMapper, useValue: mapper },
      ],
    }).compile();
    service = moduleRef.get(EmployeeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('create: email đã tồn tại → ném EMPLOYEE_EMAIL_EXISTS', async () => {
    repo.emailExists.mockResolvedValue(true);
    await expect(service.create(ORG, ACTOR, createDto)).rejects.toBeInstanceOf(
      EmployeeEmailExistsException,
    );
    expect(repo.createWithUser).not.toHaveBeenCalled();
  });

  it('create: không chọn Role → dùng Role mặc định EMPLOYEE + trả credentials (email + initialPassword)', async () => {
    repo.emailExists.mockResolvedValue(false);
    repo.findRoleByCode.mockResolvedValue({ id: 'role-1', code: 'EMPLOYEE' });
    repo.createWithUser.mockResolvedValue(employeeRow);

    const res = await service.create(ORG, ACTOR, createDto);

    expect(repo.findRoleByCode).toHaveBeenCalledWith(ORG, 'EMPLOYEE');
    expect(res.credentials.email).toBe('a@ncmedia.com');
    expect(res.credentials.initialPassword).toEqual(expect.any(String));
    expect(res.email).toBe('a@ncmedia.com');
    expect(res.role.code).toBe('EMPLOYEE');
    expect(res as unknown as Record<string, unknown>).not.toHaveProperty('passwordHash');
  });

  it('resetPassword: tồn tại → cập nhật hash + trả newPassword một lần', async () => {
    repo.findById.mockResolvedValue(employeeRow);

    const res = await service.resetPassword(ORG, ACTOR, 'emp-1');

    expect(res.newPassword).toEqual(expect.any(String));
    expect(repo.updateUserPassword).toHaveBeenCalledWith('user-1', expect.any(String), ACTOR);
  });

  it('resetPassword: không tồn tại → ném EMPLOYEE_NOT_FOUND', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.resetPassword(ORG, ACTOR, 'emp-x')).rejects.toBeInstanceOf(
      EmployeeNotFoundException,
    );
  });

  it('create: roleId không thuộc org → ném EMPLOYEE_ROLE_INVALID', async () => {
    repo.emailExists.mockResolvedValue(false);
    repo.findRoleInOrg.mockResolvedValue(null);

    await expect(
      service.create(ORG, ACTOR, { ...createDto, roleId: 'bad-role' }),
    ).rejects.toBeInstanceOf(EmployeeRoleInvalidException);
  });

  it('findOne: không tồn tại → ném EMPLOYEE_NOT_FOUND', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne(ORG, 'emp-x')).rejects.toBeInstanceOf(EmployeeNotFoundException);
  });

  it('findAll: trả items + meta phân trang', async () => {
    repo.findMany.mockResolvedValue({ items: [employeeRow], total: 1 });
    const res = await service.findAll(ORG, { page: 1, limit: 20 });
    expect(res.items).toHaveLength(1);
    expect(res.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
  });

  it('remove: tồn tại → soft delete trong transaction', async () => {
    repo.findById.mockResolvedValue(employeeRow);
    await service.remove(ORG, ACTOR, 'emp-1');
    expect(repo.softDelete).toHaveBeenCalledWith({}, 'emp-1', 'user-1', ACTOR);
  });

  it('remove: không tồn tại → ném EMPLOYEE_NOT_FOUND', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.remove(ORG, ACTOR, 'emp-x')).rejects.toBeInstanceOf(
      EmployeeNotFoundException,
    );
  });
});
