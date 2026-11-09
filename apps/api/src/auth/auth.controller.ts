import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('auth/login')
  tenantLogin(@Body() body: { tenant_id: string; email: string; password: string }) {
    return this.auth.tenantLogin(body);
  }

  @Post('platform/auth/login')
  platformLogin(@Body() body: { email: string; password: string }) {
    return this.auth.platformLogin(body);
  }

  @Post('invitations/accept')
  acceptInvitation(@Body() body: { token: string; password: string }) {
    return this.auth.acceptInvitation(body);
  }
}
