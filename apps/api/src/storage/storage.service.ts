import { Injectable, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import {
  S3Client, HeadObjectCommand, PutObjectCommand,
  HeadBucketCommand, CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    this.bucket = process.env.S3_BUCKET ?? 'firecontrol360';
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required');
    }
    this.client = new S3Client({
      endpoint,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch {
        throw new Error('Object storage bucket is unavailable; verify S3 credentials and bucket permissions');
      }
    }
  }

  async presignPhoto(input: { key: string; mimeType: string; checksum: string }) {
    try {
      const checksumBase64 = Buffer.from(input.checksum, 'hex').toString('base64');
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.mimeType,
        ChecksumSHA256: checksumBase64,
        Metadata: { sha256: input.checksum },
      });
      const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: 600 });
      return {
        upload_url: uploadUrl,
        required_headers: {
          'Content-Type': input.mimeType,
          'x-amz-checksum-sha256': checksumBase64,
          'x-amz-meta-sha256': input.checksum,
        },
      };
    } catch {
      throw new InternalServerErrorException('Could not create secure upload URL');
    }
  }

  async headObject(key: string) {
    return this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ChecksumMode: 'ENABLED',
    }));
  }
}
