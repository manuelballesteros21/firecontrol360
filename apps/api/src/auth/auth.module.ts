import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TenantAuthGuard } from './tenant-auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';

@Module({
  imports: [JwtModule.registerAsync({
    useFactory: () => {
      const secret = process.env.JWT_SECRET;
      if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
      return { secret, signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' } };
    },
  })],
  controllers: [AuthController],
  providers: [AuthService, TenantAuthGuard, PlatformAdminGuard],
  exports: [AuthService, TenantAuthGuard, PlatformAdminGuard],
})
export class AuthModule {}
