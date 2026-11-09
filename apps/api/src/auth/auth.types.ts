export interface AuthenticatedUser {
  sub: string;
  tenantId: string;
  roles: string[];
  kind: 'tenant';
}
export interface PlatformPrincipal {
  sub: string;
  kind: 'platform';
}
