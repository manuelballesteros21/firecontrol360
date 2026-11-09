import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { TenantProvisioningModule } from './tenants/tenant-provisioning.module';
import { StorageModule } from './storage/storage.module';
import { EquipmentModule } from './equipment/equipment.module';

@Module({
  imports: [DatabaseModule, AuthModule, TenantProvisioningModule, StorageModule, EquipmentModule],
  controllers: [HealthController],
})
export class AppModule {}
