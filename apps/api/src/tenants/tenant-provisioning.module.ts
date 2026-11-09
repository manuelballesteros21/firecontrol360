import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantProvisioningController } from './tenant-provisioning.controller';
import { TenantProvisioningService } from './tenant-provisioning.service';

@Module({
  imports: [AuthModule],
  controllers: [TenantProvisioningController],
  providers: [TenantProvisioningService],
})
export class TenantProvisioningModule {}
