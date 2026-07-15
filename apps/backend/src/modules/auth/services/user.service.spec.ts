import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service';
import { UserService } from './user.service';

/** Unit test SKELETON — UserService. */
describe('UserService', () => {
  let service: UserService;
  const prismaMock = { user: { findUnique: jest.fn(), create: jest.fn() } };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [UserService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.todo('hashPassword: trả về bcrypt hash (cost 12), khác plaintext');
  it.todo('findByEmail: tra cứu theo email (unique global)');
  it.todo('createAdminInTransaction: tạo user status ACTIVE với roleId ADMIN');
});
