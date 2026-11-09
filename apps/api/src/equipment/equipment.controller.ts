import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { EquipmentService } from './equipment.service';

@Controller('equipment')
@UseGuards(TenantAuthGuard)
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  @Get('catalog')
  catalog(@Req() req: { user: AuthenticatedUser }) {
    return this.equipment.catalog(req.user.tenantId);
  }

  @Get()
  list(@Req() req: { user: AuthenticatedUser }) {
    return this.equipment.list(req.user.tenantId);
  }

  @Post()
  create(@Req() req: { user: AuthenticatedUser }, @Body() body: {
    equipment_type_id: string; branch_id: string; area_id?: string; asset_code: string;
    manufacturer?: string; model?: string; serial_number?: string; capacity?: string;
  }) {
    return this.equipment.create(req.user.tenantId, req.user.sub, body);
  }

  @Post(':id/initial-photo/upload')
  createPhotoUpload(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() body: {
    mime_type: string; size_bytes: number; checksum_sha256: string;
  }) {
    return this.equipment.createInitialPhotoUpload(req.user.tenantId, req.user.sub, id, body);
  }

  @Post(':id/initial-photo/:uploadId/complete')
  completePhotoUpload(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Param('uploadId') uploadId: string) {
    return this.equipment.completeInitialPhotoUpload(req.user.tenantId, req.user.sub, id, uploadId);
  }

  @Get('qr/:token')
  byQr(@Req() req: { user: AuthenticatedUser }, @Param('token') token: string) {
    return this.equipment.findByQrToken(req.user.tenantId, token);
  }

  @Get(':id/label.pdf')
  async label(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Res() response: Response) {
    const item = await this.equipment.getForLabel(req.user.tenantId, id);
    const base = (process.env.WEB_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const qrUrl = `${base}/equipment/qr/${item.qr_token}`;
    const qrPng = await QRCode.toBuffer(qrUrl, { type: 'png', errorCorrectionLevel: 'H', margin: 1, width: 480 });
    const doc = new PDFDocument({ size: [198.4, 283.5], margins: { top: 12, bottom: 12, left: 12, right: 12 } });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
    const completed = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    doc.fontSize(10).text('FIRECONTROL 360', { align: 'center' });
    doc.moveDown(0.5);
    doc.image(qrPng, 25, 40, { fit: [148, 148], align: 'center' });
    doc.moveDown(9);
    doc.fontSize(12).text(String(item.asset_code), { align: 'center' });
    doc.fontSize(8).text('Escanea el QR e inicia sesión para consultar el expediente.', { align: 'center' });
    doc.end();
    const pdf = await completed;
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="firecontrol360-${item.asset_code}.pdf"`);
    response.send(pdf);
  }
}
