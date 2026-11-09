# Prueba manual de integración vertical

Este procedimiento valida el flujo de punta a punta en un entorno de desarrollo. No ejecutar contra producción hasta aplicar y revisar las migraciones con el responsable de base de datos.

## 0. Preparar API y datos

- Configura `.env` con `DATABASE_URL`, `PROVISIONING_DATABASE_URL`, `JWT_SECRET`, `S3_*` y `WEB_APP_URL`.
- `PROVISIONING_DATABASE_URL` es exclusivamente servidor y necesita privilegios de aprovisionamiento y lectura de invitaciones protegidas por RLS. No se comparte con frontend/móvil.
- Verifica que el esquema base 001 y la migración 0002 ya aplicados correspondan a los contratos descritos en README.
- Aplica 0003 solo después de revisar el SQL y el estado real de la base.
- Desde `apps/api`: `npm install`, después `npm run start:dev`.

## 1. Crear el primer Super Admin

En una terminal segura, define temporalmente:
- `PROVISIONING_DATABASE_URL`
- `PLATFORM_ADMIN_EMAIL`
- `PLATFORM_ADMIN_NAME`
- `PLATFORM_ADMIN_PASSWORD` (16 caracteres como mínimo)

Ejecuta `npm run bootstrap:platform-admin`. El script no reemplaza cuentas existentes.

## 2. Iniciar sesión como Super Admin

```bash
curl -X POST http://localhost:3001/api/v1/platform/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"superadmin@example.com","password":"REEMPLAZAR"}'
```

Guarda el `access_token` como `PLATFORM_TOKEN` en tu terminal, no en el repositorio.

## 3. Aprovisionar una empresa y su administrador

```bash
curl -X POST http://localhost:3001/api/v1/platform/tenants \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "legal_name":"Empresa Demo SA de CV",
    "trade_name":"Empresa Demo",
    "tax_id":"XAXX010101000",
    "admin_email":"admin@example.com",
    "admin_full_name":"Administrador Demo"
  }'
```

La respuesta incluye el `tenant.id` y un token de invitación de un solo uso. Comparte ese token por un canal seguro.

## 4. Aceptar invitación y crear sesión

```bash
curl -X POST http://localhost:3001/api/v1/invitations/accept \
  -H "Content-Type: application/json" \
  -d '{"token":"TOKEN_DE_INVITACION","password":"CAMBIAR_POR_UNA_CONTRASENA_LARGA"}'
```

La respuesta devuelve un JWT tenant. También se puede iniciar sesión después con:
```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"TENANT_UUID","email":"admin@example.com","password":"CAMBIAR_POR_UNA_CONTRASENA_LARGA"}'
```

Verifica `GET /api/v1/auth/me` con el bearer token.

## 5. Consultar catálogo y registrar extintor

```bash
curl http://localhost:3001/api/v1/equipment/catalog \
  -H "Authorization: Bearer $TENANT_TOKEN"
```

Usa los UUID devueltos para crear un activo:
```bash
curl -X POST http://localhost:3001/api/v1/equipment \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "equipment_type_id":"UUID_TIPO_EXT_PQS",
    "branch_id":"UUID_SUCURSAL_MATRIZ",
    "asset_code":"EXT-0001",
    "manufacturer":"Fabricante",
    "model":"Modelo",
    "serial_number":"SERIE-0001",
    "capacity":"4.5 kg"
  }'
```

El equipo debe quedar en estado `PENDING_PHOTO`.

## 6. Subir fotografía inicial

Calcula SHA-256 del archivo local:
```bash
sha256sum ./extintor.jpg
wc -c < ./extintor.jpg
```

Solicita URL firmada, con un `idempotency_key` nuevo por intento lógico:
```bash
curl -X POST http://localhost:3001/api/v1/equipment/EQUIPMENT_UUID/initial-photo/upload \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mime_type":"image/jpeg",
    "size_bytes":123456,
    "checksum_sha256":"SHA256_HEX_DE_64_CARACTERES",
    "idempotency_key":"photo-initial-ext-0001-v1"
  }'
```

Carga el archivo binario a la URL devuelta usando exactamente los headers devueltos:
```bash
curl -X PUT "UPLOAD_URL_FIRMADA" \
  -H "Content-Type: image/jpeg" \
  -H "x-amz-checksum-sha256: SHA256_BASE64" \
  -H "x-amz-meta-sha256: SHA256_HEX" \
  --data-binary @./extintor.jpg
```

Finaliza la carga:
```bash
curl -X POST http://localhost:3001/api/v1/equipment/EQUIPMENT_UUID/initial-photo/UPLOAD_UUID/complete \
  -H "Authorization: Bearer $TENANT_TOKEN"
```

La respuesta debe indicar `status: ACTIVE`. Después descarga `GET /api/v1/equipment/EQUIPMENT_UUID/label.pdf`.

## 7. Prueba negativa de aislamiento

- Aprovisiona una segunda empresa y acepta su invitación con otro usuario.
- Inicia sesión en el tenant B.
- Intenta consultar el equipo creado en el tenant A usando su UUID.
- El resultado esperado es `404` o no encontrado; nunca debe devolver información del tenant A.
- Repite la prueba con los UUID de sucursal, tipo y carga de fotografía.

## Limitaciones conocidas del MVP

- El token de invitación se entrega una sola vez en la respuesta de aprovisionamiento; todavía no hay correo transaccional ni pantalla web de aceptación.
- El bucket se crea privado, pero CORS debe configurarse para los orígenes web autorizados.
- La validación de imagen debe ampliarse con decodificación real/antivirus antes de producción.
- No se han ejecutado pruebas contra la base PostgreSQL ni el MinIO del usuario desde este entorno.
