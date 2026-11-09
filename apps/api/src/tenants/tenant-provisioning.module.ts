import { Module } from '@nestjs/common';
import { TenantProvisioningController } from './tenant-provisioning.controller';
import { TenantProvisioningService } from './tenant-provisioning.service';

@Module({
  controllers: [TenantProvisioningController],
  providers: [TenantProvisioningService],
})
export class TenantProvisioningModule {}
