# FireControl 360 — Starter técnico v0.1

Base inicial para FireControl 360 SaaS multiempresa.

## Incluye
- PostgreSQL 16 con esquema inicial y relaciones tenant-aware.
- Row Level Security (RLS) en tablas operativas.
- Inventario, fotos iniciales, programación, calendario, inspecciones, evidencias, recordatorios, hallazgos, acciones correctivas y bitácora.
- NestJS API con endpoint de salud `/api/v1/health`.
- Docker Compose para PostgreSQL y MinIO local.
- Carpetas reservadas para Next.js y Expo.

## Requisitos
- Docker Desktop / Docker Engine + Docker Compose
- Node.js 20 o superior (para ejecutar API)

## Arranque de infraestructura
1. Copiar `.env.example` a `.env`.
2. Cambiar las contraseñas de ejemplo.
3. Ejecutar `docker compose up -d`.
4. Verificar PostgreSQL en `localhost:5432` y consola MinIO en `http://localhost:9001`.

El SQL de `db/init` se ejecuta automáticamente solo al crear por primera vez el volumen de PostgreSQL. Para reiniciar datos locales desde cero: `docker compose down -v` y luego `docker compose up -d` (esto elimina los datos locales).

## Arranque de API
Desde `apps/api`:
```bash
npm install
```
Configurar `DATABASE_URL` y `PORT` en el entorno de ejecución y luego:
```bash
npm run start:dev
```
Probar: `GET http://localhost:3001/api/v1/health`.

## Seguridad multiempresa: regla obligatoria
Cada petición autenticada debe resolver `tenant_id` desde la sesión/token verificado, no desde un parámetro enviado por el navegador. Las consultas deben ejecutarse dentro de una transacción y establecer el contexto de tenant:
```sql
BEGIN;
SELECT set_config('app.tenant_id', '<UUID_DEL_TENANT_AUTENTICADO>', true);
-- consultas tenant-aware aquí
COMMIT;
```
El rol runtime de la API no debe ser dueño de las tablas ni tener `BYPASSRLS`. Las migraciones y el aprovisionamiento de tenants deben usar un rol administrativo separado. No usar el usuario superuser de PostgreSQL en producción.

## Controles pendientes antes de producción
- Autenticación completa, hash de contraseñas y recuperación MFA opcional.
- Guard de tenant y transacciones RLS en todos los repositorios.
- RBAC granular y pruebas de aislamiento entre tenants.
- Bucket privado, URLs firmadas, antivirus/validación MIME y retención de evidencias.
- Servicio de notificaciones con idempotencia y zona horaria por tenant.
- Cierre de inspección transaccional que valide evidencia fotográfica.
- Migraciones versionadas, backups, observabilidad, rate limiting y pruebas automatizadas.

Este starter es una base de desarrollo, no un sistema productivo ni una certificación normativa.
