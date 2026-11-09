# FireControl 360 — Vertical integration MVP

SaaS multiempresa para inventario e inspección de sistemas contra incendios. Esta rama contiene el starter y la primera integración vertical de API.

## Stack
- API: NestJS 10 + TypeScript.
- Datos: PostgreSQL 16 con aislamiento tenant-aware y Row Level Security (RLS).
- Evidencias: almacenamiento S3 compatible (MinIO en desarrollo).
- Etiquetas: QR y PDF de 70 × 100 mm.

## Arranque local
1. Copia `.env.example` a `.env` y cambia todas las contraseñas/secretos.
2. Inicia infraestructura: `docker compose up -d`.
3. Instala dependencias: `cd apps/api && npm install`.
4. Inicia API: `npm run start:dev`.
5. Health check: `GET http://localhost:3001/api/v1/health`.

El SQL de `db/init/001_schema.sql` se ejecuta automáticamente solo cuando PostgreSQL inicializa un volumen vacío. No lo ejecutes sobre una base existente.

## Migración de integración vertical
El archivo `db/migrations/0002_vertical_integration.sql` agrega:
- Identidades de Super Admin.
- Invitaciones de administrador con token SHA-256, expiración y aceptación de un solo uso.
- Outbox de notificaciones con payload cifrado (el worker de correo aún está pendiente).
- Sesiones de carga de fotografía inicial e idempotencia.
- Estado `PENDING_PHOTO` y políticas RLS.

**La migración está versionada en GitHub, pero no se ejecuta automáticamente ni fue aplicada por este código.** Antes de aplicarla en una base existente, compara su contenido con el SQL que ya ejecutaste y verifica el estado real de las tablas. No ejecutes dos veces scripts distintos con el mismo número de migración.

## Roles y conexiones PostgreSQL
Configura dos conexiones distintas:
- `DATABASE_URL`: rol runtime de API; no debe ser dueño de las tablas ni tener `BYPASSRLS`.
- `PROVISIONING_DATABASE_URL`: credencial exclusivamente del backend para bootstrap de Super Admin, aprovisionamiento y aceptación de invitaciones. El flujo actual consulta invitaciones sin tenant previo; por ello este rol necesita acceso privilegiado de servidor (incluido `BYPASSRLS`) y nunca debe exponerse al navegador, móvil, logs o respuestas HTTP. Limita sus permisos y acceso de red.

El runtime establece el tenant desde el JWT verificado dentro de una transacción:
```sql
SELECT set_config('app.tenant_id', '<tenant-id-del-JWT>', true);
```
No aceptes `tenant_id` desde el cuerpo de una petición para autorizar acceso.

## Bootstrap del primer Super Admin
Después de aplicar la migración con un rol de migraciones controlado, ejecuta el bootstrap una sola vez desde `apps/api` con estas variables de entorno configuradas en el servidor/terminal:
- `PROVISIONING_DATABASE_URL`
- `PLATFORM_ADMIN_EMAIL`
- `PLATFORM_ADMIN_NAME`
- `PLATFORM_ADMIN_PASSWORD` (mínimo 16 caracteres)

Comando: `npm run bootstrap:platform-admin`.

El script no sobrescribe un Super Admin existente. No guardes la contraseña en el repositorio ni la compartas en el chat.

## API disponible
Todas las rutas llevan prefijo `/api/v1`.

| Método | Ruta | Función |
|---|---|---|
| POST | `/platform/auth/login` | Inicio de sesión Super Admin |
| POST | `/platform/tenants` | Aprovisionar empresa y administrador inicial |
| POST | `/invitations/accept` | Aceptar invitación y definir contraseña |
| POST | `/auth/login` | Inicio de sesión de usuario tenant |
| GET | `/equipment/catalog` | Catálogo de sucursales y tipos |
| POST | `/equipment` | Registrar equipo como `PENDING_PHOTO` |
| POST | `/equipment/:id/initial-photo/upload` | Crear URL firmada de carga |
| POST | `/equipment/:id/initial-photo/:uploadId/complete` | Verificar objeto, guardar evidencia y activar |
| GET | `/equipment` | Consultar inventario |
| GET | `/equipment/:id/label.pdf` | Descargar etiqueta QR |
| GET | `/equipment/qr/:token` | Consultar expediente con sesión y tenant válidos |

La invitación se entrega como token de un solo uso en la respuesta de aprovisionamiento para compartirlo manualmente por un canal seguro. La pantalla web de aceptación y el envío automático de correo todavía no están implementados. El outbox está preparado para esa siguiente etapa.

## Flujo de fotografía
1. El administrador registra el equipo; queda en `PENDING_PHOTO`.
2. Solicita una URL firmada con MIME, tamaño y SHA-256 declarados.
3. El cliente carga directamente a S3/MinIO con los headers firmados.
4. El cliente llama a `complete`; la API verifica tamaño, MIME y checksum SHA-256 del objeto.
5. Solo entonces se inserta la foto inicial y el equipo pasa a `ACTIVE`.
6. La etiqueta PDF se habilita para equipos activos.

El bucket debe permanecer privado. Configura CORS del bucket para permitir PUT únicamente desde los orígenes web autorizados; no hagas público el bucket. La URL firmada expira en 10 minutos y el límite de foto es 10 MB.

## Pendiente antes de producción
- Comparar y aplicar migración con control de versiones en la base destino.
- Bootstrap seguro de roles PostgreSQL y verificación real de RLS.
- Worker/outbox y proveedor de correo; interfaz web de invitación.
- Antivirus/decodificación de imagen y validación real del archivo (no solo MIME declarado).
- CORS de bucket, lifecycle/retención, cifrado y backups.
- Rate limiting, refresh/revocación de sesiones, MFA, auditoría y pruebas automatizadas.
- Pruebas de integración en PostgreSQL/MinIO reales y prueba negativa de aislamiento entre dos tenants.

Este MVP es una base de desarrollo, no un sistema productivo ni una certificación normativa. Las referencias normativas deben validarse por personal competente antes de emitir dictámenes o declaraciones de cumplimiento.
