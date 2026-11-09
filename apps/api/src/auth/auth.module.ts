import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TenantAuthGuard } from './tenant-auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TenantAuthGuard, PlatformAdminGuard],
  exports: [AuthService, TenantAuthGuard, PlatformAdminGuard],
})
export class AuthModule {}
