import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service';
import { OrganizationService } from './organization.service';

/** Unit test SKELETON — OrganizationService. */
describe('OrganizationService', () => {
  let service: OrganizationService;
  const prismaMock = { organization: { findUnique: jest.fn(), create: jest.fn() } };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [OrganizationService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(OrganizationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.todo('slugify: chuyển tên có dấu tiếng Việt về ^[a-z0-9-]+$');
  it.todo('generateUniqueSlug: thêm hậu tố khi slug đã tồn tại');
  it.todo('createInTransaction: tạo org với status ACTIVE');
});
