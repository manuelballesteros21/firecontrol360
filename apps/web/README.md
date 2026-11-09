# FireControl 360 Web

Aplicación Next.js con dos vistas:
- `/`: login de empresa, inventario, alta de equipo, carga de fotografía inicial y descarga de etiqueta QR.
- `/accept-invitation?token=...`: aceptación de invitación y activación de cuenta.

## Desarrollo
1. Copia `.env.example` a `.env.local`.
2. Configura `NEXT_PUBLIC_API_URL`.
3. Ejecuta `npm install` y `npm run dev`.
4. Abre http://localhost:3000.

La API y el bucket S3/MinIO deben estar activos. Configura CORS de MinIO para el origen web local y permite PUT con los encabezados firmados por la API.
