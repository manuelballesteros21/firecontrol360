import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantAdminGuard } from '../auth/tenant-admin.guard';
import { EquipmentController } from './equipment.controller';
import { EquipmentService } from './equipment.service';

@Module({
  imports: [AuthModule],
  controllers: [EquipmentController],
  providers: [EquipmentService, TenantAdminGuard],
})
export class EquipmentModule {}
