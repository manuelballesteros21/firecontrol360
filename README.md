# FireControl 360 — Starter técnico v0.1

Base inicial para FireControl 360 SaaS multiempresa.

## Contenido del starter
- PostgreSQL 16 con esquema inicial y relaciones tenant-aware.
- Row Level Security (RLS) en tablas operativas.
- Inventario, fotografías iniciales, programación, inspecciones, evidencias, recordatorios, hallazgos, acciones correctivas y bitácora.
- API NestJS con endpoint de salud `/api/v1/health`.
- Docker Compose para PostgreSQL y MinIO local.
- Carpetas reservadas para frontend web Next.js y aplicación móvil Expo.

## Inicio local
1. Copia `.env.example` a `.env` y cambia las contraseñas de ejemplo.
2. Ejecuta `docker compose up -d`.
3. En `apps/api`, ejecuta `npm install` y `npm run start:dev`.
4. Verifica `GET http://localhost:3001/api/v1/health`.

## Seguridad multiempresa
La API debe obtener `tenant_id` de la sesión autenticada, nunca de un parámetro controlado por el navegador. Las consultas tenant-aware deben ejecutarse dentro de transacciones y establecer el contexto mediante `set_config('app.tenant_id', '<UUID_DEL_TENANT_AUTENTICADO>', true)`. El rol runtime no debe ser dueño de las tablas ni tener `BYPASSRLS`; usa un rol administrativo separado para migraciones y aprovisionamiento.

## Pendiente antes de producción
Autenticación completa, RBAC, guard de tenant, pruebas de aislamiento, bucket privado y URLs firmadas, validación MIME/antivirus, notificaciones idempotentes, cierre transaccional de inspecciones, migraciones versionadas, backups, observabilidad, rate limiting y pruebas automatizadas.

Este starter es una base de desarrollo, no un sistema productivo ni una certificación normativa.