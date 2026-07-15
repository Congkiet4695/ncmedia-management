import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RegisterOrganizationDto } from './dto/register-organization.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { RegisterService } from './services/register.service';

@ApiTags('Auth')
@Controller('auth')
export class RegisterController {
  constructor(private readonly registerService: RegisterService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register Organization + tạo Admin đầu tiên' })
  @ApiCreatedResponse({ type: RegisterResponseDto })
  @ApiConflictResponse({ description: 'Email đã tồn tại (AUTH_EMAIL_EXISTS)' })
  @ApiBadRequestResponse({ description: 'Dữ liệu không hợp lệ (VALIDATION_ERROR)' })
  register(
    @Body() dto: RegisterOrganizationDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<RegisterResponseDto> {
    return this.registerService.register(dto, { ipAddress: ip, userAgent });
  }
}
