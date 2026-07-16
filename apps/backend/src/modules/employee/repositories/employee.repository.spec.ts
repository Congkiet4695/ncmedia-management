/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EmployeeStatus, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { EmployeeRepository } from './employee.repository';

/**
 * Unit test — EmployeeRepository.
 * Trọng tâm: **tenant isolation** — mọi where-clause phải chứa `organizationId` + `deletedAt: null`
 * (chặn hồi quy nếu ai đó lỡ bỏ điều kiện tenant). Bổ sung theo Finding M-3 (review).
 */
describe('EmployeeRepository', () => {
  let repo: EmployeeRepository;

  const prisma = {
    employee: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    user: { count: jest.fn(), create: jest.fn(), update: jest.fn() },
    role: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [EmployeeRepository, { provide: PrismaService, useValue: prisma }],
    }).compile();
    repo = moduleRef.get(EmployeeRepository);
  });

  it('findById: where có id + organizationId + deletedAt=null (tenant isolation)', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await repo.findById('org-1', 'emp-1');
    expect(prisma.employee.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'emp-1', organizationId: 'org-1', deletedAt: null },
        include: expect.any(Object),
      }),
    );
  });

  it('findMany: where có organizationId + deletedAt=null + filter user (fullname/status)', async () => {
    prisma.employee.findMany.mockResolvedValue([]);
    prisma.employee.count.mockResolvedValue(0);
    prisma.$transaction.mockResolvedValue([[], 0]);

    await repo.findMany('org-1', {
      page: 1,
      limit: 10,
      fullname: 'nguyen',
      status: EmployeeStatus.ACTIVE,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          deletedAt: null,
          status: EmployeeStatus.ACTIVE,
          user: expect.objectContaining({
            fullName: { contains: 'nguyen', mode: 'insensitive' },
          }),
        }),
        skip: 0,
        take: 10,
      }),
    );
  });

  it('emailExists: đếm trên toàn bảng users theo email (global unique)', async () => {
    prisma.user.count.mockResolvedValue(1);
    const exists = await repo.emailExists('a@ncmedia.com');
    expect(exists).toBe(true);
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { email: 'a@ncmedia.com' } });
  });

  it('createWithUser: tạo User trước rồi Employee với cùng organizationId', async () => {
    const tx = {
      user: { create: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      employee: { create: jest.fn().mockResolvedValue({ id: 'emp-1' }) },
    } as unknown as Prisma.TransactionClient;

    await repo.createWithUser(tx, {
      organizationId: 'org-1',
      actorUserId: 'admin-1',
      roleId: 'role-1',
      email: 'a@ncmedia.com',
      passwordHash: '$2b$12$hash',
      fullName: 'Nguyen Van A',
      employeeStatus: EmployeeStatus.ACTIVE,
      userStatus: UserStatus.ACTIVE,
    });

    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', roleId: 'role-1', email: 'a@ncmedia.com' }),
      }),
    );
    expect(tx.employee.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
      }),
    );
  });

  it('softDelete: set deleted_at cho cả Employee và User', async () => {
    const tx = {
      employee: { update: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
    } as unknown as Prisma.TransactionClient;

    await repo.softDelete(tx, 'emp-1', 'user-1', 'admin-1');

    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'emp-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date), updatedBy: 'admin-1' }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date), updatedBy: 'admin-1' }),
      }),
    );
  });
});
