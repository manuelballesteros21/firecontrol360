import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { TenantProvisioningService } from './tenant-provisioning.service';

@Controller('platform/tenants')
@UseGuards(PlatformAdminGuard)
export class TenantProvisioningController {
  constructor(private readonly provisioning: TenantProvisioningService) {}

  @Post()
  create(@Body() body: {
    legal_name: string; trade_name?: string; tax_id?: string;
    admin_email: string; admin_full_name: string;
  }, @Req() request: { platformAdmin: { id: string } }) {
    return this.provisioning.provision(body, request.platformAdmin.id);
  }
}
