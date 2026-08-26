import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { MailService } from '../../mail/services/mail.service';
import { RegisterOrganizationDto } from '../dto/register-organization.dto';
import { OrganizationService } from './organization.service';
import { PermissionService } from './permission.service';
import { RegisterService } from './register.service';
import { RoleService } from './role.service';
import { UserService } from './user.service';

/**
 * RegisterService — luồng đăng ký đi qua HÀNG CHỜ DUYỆT.
 *
 * 🔴 Ba luật bị khoá ở đây, vì phá luật nào cũng làm cả tính năng vô nghĩa:
 *   1. Organization tạo ra ở trạng thái PENDING (không phải ACTIVE).
 *   2. KHÔNG phát hành token — nếu không thì người đăng ký vào thẳng hệ thống.
 *   3. SMTP hỏng KHÔNG được làm đăng ký thất bại.
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
  const mailServiceMock = {
    sendOrganizationRegistered: jest.fn().mockResolvedValue({ sent: true }),
  };

  const dto: RegisterOrganizationDto = {
    organizationName: 'NCMedia Co.',
    fullName: 'Nguyen Van A',
    email: 'admin@ncmedia.com',
    password: 'P@ssw0rd123',
  };

  const organization = {
    id: 'org-1',
    name: 'NCMedia Co.',
    slug: 'ncmedia-co',
    status: OrganizationStatus.PENDING,
  };
  const admin = {
    id: 'user-1',
    email: 'admin@ncmedia.com',
    fullName: 'Nguyen Van A',
    status: UserStatus.PENDING,
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        RegisterService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: OrganizationService, useValue: organizationServiceMock },
        { provide: RoleService, useValue: roleServiceMock },
        { provide: PermissionService, useValue: permissionServiceMock },
        { provide: UserService, useValue: userServiceMock },
        { provide: MailService, useValue: mailServiceMock },
      ],
    }).compile();

    service = moduleRef.get(RegisterService);

    jest.clearAllMocks();
    mailServiceMock.sendOrganizationRegistered.mockResolvedValue({ sent: true });
    userServiceMock.findByEmail.mockResolvedValue(null);
    userServiceMock.hashPassword.mockResolvedValue('$2b$12$hash');
    organizationServiceMock.generateUniqueSlug.mockResolvedValue('ncmedia-co');
    // `$transaction(cb)` — chạy callback với một tx giả để kiểm tra đúng đường code thật.
    prismaMock.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => {
      organizationServiceMock.createInTransaction.mockResolvedValue(organization);
      roleServiceMock.seedDefaultRolesInTransaction.mockResolvedValue({
        ADMIN: { id: 'role-admin' },
        EMPLOYEE: { id: 'role-employee' },
        FULFILLMENT: { id: 'role-fulfillment' },
      });
      userServiceMock.createAdminInTransaction.mockResolvedValue(admin);
      return cb({});
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('🔴 Organization tạo ra ở trạng thái PENDING, chủ Organization cũng PENDING', async () => {
    await service.register(dto);

    expect(organizationServiceMock.createInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: OrganizationStatus.PENDING }),
    );
    expect(userServiceMock.createAdminInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: UserStatus.PENDING }),
    );
  });

  it('🔴 KHÔNG phát hành token — người đăng ký phải chờ Super Admin duyệt', async () => {
    const result = await service.register(dto);

    // Còn `tokens` trong response nghĩa là frontend đăng nhập được ngay ⇒ vô hiệu hoá cả
    // luồng duyệt. Đây là hồi quy đắt nhất có thể xảy ra với tính năng này.
    expect(result).not.toHaveProperty('tokens');
    expect(result.organization.status).toBe(OrganizationStatus.PENDING);
    expect(result.user.status).toBe(UserStatus.PENDING);
  });

  it('gửi email "Organization Registration Received" sau khi commit', async () => {
    await service.register(dto);

    expect(mailServiceMock.sendOrganizationRegistered).toHaveBeenCalledWith({
      to: 'admin@ncmedia.com',
      fullName: 'Nguyen Van A',
      organizationName: 'NCMedia Co.',
    });
  });

  it('🔴 SMTP hỏng KHÔNG làm đăng ký thất bại — chỉ báo emailSent = false', async () => {
    // Organization đã nằm trong database rồi; ném lỗi ở đây chỉ khiến người dùng bấm đăng ký
    // lần nữa và nhận về lỗi trùng email.
    mailServiceMock.sendOrganizationRegistered.mockResolvedValue({
      sent: false,
      error: 'ECONNREFUSED',
    });

    const result = await service.register(dto);

    expect(result.emailSent).toBe(false);
    expect(result.organization.id).toBe('org-1');
  });

  it('phone tuỳ chọn được lưu cùng tài khoản chủ Organization', async () => {
    await service.register({ ...dto, phone: '0912345678' });

    expect(userServiceMock.createAdminInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ phone: '0912345678' }),
    );
  });

  it.todo('ném EmailAlreadyExistsException khi email đã tồn tại');
  it.todo('map lỗi Prisma P2002 (email) thành EmailAlreadyExistsException');
  it.todo('rollback khi bất kỳ bước nào trong transaction thất bại');
});
