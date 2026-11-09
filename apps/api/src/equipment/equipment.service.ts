import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class EquipmentService {
  constructor(private readonly db: DatabaseService, private readonly storage: StorageService) {}

  async catalog(tenantId: string) {
    return this.db.withTenant(tenantId, async client => {
      const [branches, equipmentTypes] = await Promise.all([
        client.query("SELECT id, code, name FROM branches WHERE status = 'ACTIVE' ORDER BY name"),
        client.query("SELECT id, code, name FROM equipment_types WHERE active = true ORDER BY name"),
      ]);
      return { branches: branches.rows, equipment_types: equipmentTypes.rows };
    });
  }

  async create(tenantId: string, userId: string, input: {
    equipment_type_id: string; branch_id: string; area_id?: string; asset_code: string;
    manufacturer?: string; model?: string; serial_number?: string; capacity?: string;
  }) {
    if (!input.equipment_type_id || !input.branch_id || !input.asset_code?.trim()) {
      throw new BadRequestException('equipment_type_id, branch_id and asset_code are required');
    }
    return this.db.withTenant(tenantId, async client => {
      const result = await client.query(
        `INSERT INTO equipment
          (tenant_id, equipment_type_id, branch_id, area_id, asset_code, manufacturer, model, serial_number, capacity, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING_PHOTO',$10)
         RETURNING id, tenant_id, asset_code, qr_token, status, created_at`,
        [tenantId, input.equipment_type_id, input.branch_id, input.area_id ?? null,
          input.asset_code.trim(), input.manufacturer?.trim() ?? null, input.model?.trim() ?? null,
          input.serial_number?.trim() ?? null, input.capacity?.trim() ?? null, userId],
      );
      return { equipment: result.rows[0], next_step: 'UPLOAD_INITIAL_PHOTO' };
    });
  }

  async list(tenantId: string) {
    return this.db.withTenant(tenantId, async client => {
      const result = await client.query(
        `SELECT e.id, e.asset_code, e.status, e.qr_token, e.manufacturer, e.model, e.serial_number,
                et.code AS equipment_type_code, et.name AS equipment_type_name,
                b.code AS branch_code, b.name AS branch_name,
                (SELECT ep.object_key FROM equipment_photos ep
                 WHERE ep.tenant_id = e.tenant_id AND ep.equipment_id = e.id AND ep.photo_type = 'INITIAL'
                 LIMIT 1) AS initial_photo_key
         FROM equipment e
         JOIN equipment_types et ON et.tenant_id = e.tenant_id AND et.id = e.equipment_type_id
         JOIN branches b ON b.tenant_id = e.tenant_id AND b.id = e.branch_id
         ORDER BY e.created_at DESC LIMIT 250`,
      );
      return result.rows;
    });
  }

  async createInitialPhotoUpload(tenantId: string, userId: string, equipmentId: string, input: {
    mime_type: string; size_bytes: number; checksum_sha256: string;
  }) {
    if (!ALLOWED_MIME.has(input.mime_type)) throw new BadRequestException('Only JPEG, PNG or WebP images are accepted');
    if (!Number.isInteger(input.size_bytes) || input.size_bytes < 1 || input.size_bytes > MAX_PHOTO_BYTES) {
      throw new BadRequestException('Photo size must be between 1 byte and 10 MB');
    }
    if (!/^[a-fA-F0-9]{64}$/.test(input.checksum_sha256 ?? '')) {
      throw new BadRequestException('checksum_sha256 must be a SHA-256 hex digest');
    }
    return this.db.withTenant(tenantId, async client => {
      const equipment = await client.query(
        "SELECT id, status FROM equipment WHERE id = $1 FOR UPDATE",
        [equipmentId],
      );
      if (equipment.rowCount !== 1) throw new NotFoundException('Equipment not found');
      if (equipment.rows[0].status !== 'PENDING_PHOTO') {
        throw new BadRequestException('Initial photo can only be uploaded while equipment is PENDING_PHOTO');
      }
      const uploadId = randomUUID();
      const objectKey = `tenants/${tenantId}/equipment/${equipmentId}/initial/${uploadId}`;
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await client.query(
        `INSERT INTO equipment_photo_uploads
          (id, tenant_id, equipment_id, object_key, mime_type, size_bytes, checksum_sha256, expires_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [uploadId, tenantId, equipmentId, objectKey, input.mime_type, input.size_bytes,
          input.checksum_sha256.toLowerCase(), expiresAt, userId],
      );
      const signed = await this.storage.presignPhoto({
        key: objectKey, mimeType: input.mime_type, checksum: input.checksum_sha256.toLowerCase(),
      });
      return { upload_id: uploadId, ...signed, expires_at: expiresAt.toISOString() };
    });
  }

  async completeInitialPhotoUpload(tenantId: string, userId: string, equipmentId: string, uploadId: string) {
    return this.db.withTenant(tenantId, async client => {
      const result = await client.query(
        `SELECT id, object_key, mime_type, size_bytes, checksum_sha256, status, expires_at
         FROM equipment_photo_uploads
         WHERE id = $1 AND equipment_id = $2 AND tenant_id = $3
         FOR UPDATE`,
        [uploadId, equipmentId, tenantId],
      );
      if (result.rowCount !== 1) throw new NotFoundException('Photo upload not found');
      const upload = result.rows[0];
      if (upload.status !== 'PENDING' || new Date(upload.expires_at).getTime() <= Date.now()) {
        throw new BadRequestException('Photo upload is expired or already completed');
      }
      const head = await this.storage.headObject(upload.object_key);
      if (Number(head.ContentLength) !== Number(upload.size_bytes) ||
          head.ContentType !== upload.mime_type ||
          head.Metadata?.sha256 !== upload.checksum_sha256 ||
          head.ChecksumSHA256 !== Buffer.from(upload.checksum_sha256, 'hex').toString('base64')) {
        throw new BadRequestException('Uploaded object does not match the declared size, MIME type and checksum metadata');
      }
      const equipment = await client.query(
        "SELECT id, status FROM equipment WHERE id = $1 FOR UPDATE",
        [equipmentId],
      );
      if (equipment.rowCount !== 1 || equipment.rows[0].status !== 'PENDING_PHOTO') {
        throw new BadRequestException('Equipment is not waiting for its initial photo');
      }
      await client.query(
        `INSERT INTO equipment_photos
          (tenant_id, equipment_id, object_key, photo_type, captured_at, uploaded_by, checksum_sha256)
         VALUES ($1,$2,$3,'INITIAL',now(),$4,$5)`,
        [tenantId, equipmentId, upload.object_key, userId, upload.checksum_sha256],
      );
      await client.query(
        "UPDATE equipment SET status = 'ACTIVE', updated_at = now() WHERE tenant_id = $1 AND id = $2",
        [tenantId, equipmentId],
      );
      await client.query(
        "UPDATE equipment_photo_uploads SET status = 'COMPLETED', completed_at = now() WHERE tenant_id = $1 AND id = $2",
        [tenantId, uploadId],
      );
      return { equipment_id: equipmentId, status: 'ACTIVE', initial_photo: 'SAVED' };
    });
  }

  async findByQrToken(tenantId: string, token: string) {
    return this.db.withTenant(tenantId, async client => {
      const result = await client.query(
        `SELECT e.id, e.asset_code, e.status, e.manufacturer, e.model, e.serial_number, e.capacity,
                et.name AS equipment_type, b.name AS branch,
                ep.object_key AS initial_photo_key
         FROM equipment e
         JOIN equipment_types et ON et.tenant_id = e.tenant_id AND et.id = e.equipment_type_id
         JOIN branches b ON b.tenant_id = e.tenant_id AND b.id = e.branch_id
         LEFT JOIN equipment_photos ep ON ep.tenant_id = e.tenant_id AND ep.equipment_id = e.id AND ep.photo_type = 'INITIAL'
         WHERE e.qr_token = $1 LIMIT 1`,
        [token],
      );
      if (result.rowCount !== 1) throw new NotFoundException('Equipment QR not found');
      return result.rows[0];
    });
  }

  async getForLabel(tenantId: string, equipmentId: string) {
    return this.db.withTenant(tenantId, async client => {
      const result = await client.query(
        `SELECT id, asset_code, qr_token, status FROM equipment WHERE id = $1 LIMIT 1`,
        [equipmentId],
      );
      if (result.rowCount !== 1) throw new NotFoundException('Equipment not found');
      if (result.rows[0].status !== 'ACTIVE') throw new BadRequestException('QR labels are available after the initial photo is validated');
      return result.rows[0];
    });
  }
}
