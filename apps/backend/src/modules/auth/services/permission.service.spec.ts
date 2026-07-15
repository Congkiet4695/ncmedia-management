import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service';
import { PermissionService } from './permission.service';

/** Unit test SKELETON — PermissionService. */
describe('PermissionService', () => {
  let service: PermissionService;
  const prismaMock = { permission: { findMany: jest.fn() } };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PermissionService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(PermissionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.todo('findAllIdsInTransaction: trả về mảng id permission');
});
