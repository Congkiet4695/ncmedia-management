import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service';
import { RoleService } from './role.service';

/** Unit test SKELETON — RoleService. */
describe('RoleService', () => {
  let service: RoleService;
  const prismaMock = { role: { create: jest.fn() }, rolePermission: { createMany: jest.fn() } };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [RoleService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(RoleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.todo('seedDefaultRolesInTransaction: tạo ADMIN/EMPLOYEE/FULFILLMENT với is_system=true');
  it.todo('assignPermissionsInTransaction: bỏ qua khi danh sách rỗng');
  it.todo('assignPermissionsInTransaction: createMany với skipDuplicates');
});
