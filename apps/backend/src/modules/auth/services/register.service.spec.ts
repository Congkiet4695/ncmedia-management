import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service';
import { OrganizationService } from './organization.service';
import { PermissionService } from './permission.service';
import { RegisterService } from './register.service';
import { RoleService } from './role.service';
import { TokenService } from './token.service';
import { UserService } from './user.service';

/**
 * Unit test SKELETON — RegisterService.
 * TODO: hoàn thiện assertion khi implement test thật (dùng mock, không cần DB).
 */
describe('RegisterService', () => {
  let service: RegisterService;

  const prismaMock = {
    $transaction: jest.fn(),
  };
  const organizationServiceMock = {
    generateUniqueSlug: jest.fn(),
    createInTransaction: jest.fn(),
  };
  const roleServiceMock = {
    seedDefaultRolesInTransaction: jest.fn(),
    assignPermissionsInTransaction: jest.fn(),
  };
  const permissionServiceMock = {
    findAllIdsInTransaction: jest.fn().mockResolvedValue([]),
    findIdsByCodesInTransaction: jest.fn().mockResolvedValue([]),
  };
  const userServiceMock = {
    findByEmail: jest.fn(),
    hashPassword: jest.fn(),
    createAdminInTransaction: jest.fn(),
  };
  const tokenServiceMock = { issueTokens: jest.fn() };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        RegisterService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: OrganizationService, useValue: organizationServiceMock },
        { provide: RoleService, useValue: roleServiceMock },
        { provide: PermissionService, useValue: permissionServiceMock },
        { provide: UserService, useValue: userServiceMock },
        { provide: TokenService, useValue: tokenServiceMock },
      ],
    }).compile();

    service = moduleRef.get(RegisterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.todo('ném EmailAlreadyExistsException khi email đã tồn tại');
  it.todo('sinh slug + hash password trước khi mở transaction');
  it.todo('chạy đúng thứ tự: Organization -> Roles -> RolePermission -> Admin User');
  it.todo('gán toàn bộ permission catalog cho Role ADMIN');
  it.todo('phát hành Access + Refresh Token sau khi commit');
  it.todo('map lỗi Prisma P2002 (email) thành EmailAlreadyExistsException');
  it.todo('rollback khi bất kỳ bước nào trong transaction thất bại');
});
