/**
 * MinIO storage service
 * Handles screenshot uploads and signed URL generation
 */

const fs = require('fs');
const path = require('path');
const MinIO = require('minio');

let minioClient = null;
const BUCKET_NAME = process.env.MINIO_BUCKET || 'screenshots';
const MINIO_PUBLIC_BASE_URL = (process.env.MINIO_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const LOCAL_STORAGE_ROOT = path.join(__dirname, '../../uploads');

function getLocalObjectPath(objectKey) {
  const normalized = String(objectKey || '').replace(/^\/+/, '');
  return path.join(LOCAL_STORAGE_ROOT, normalized);
}

function ensureLocalDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function rewriteSignedUrl(url) {
  if (!url) return url;

  const publicBase = MINIO_PUBLIC_BASE_URL || (() => {
    const backendUrl = (process.env.PUBLIC_BACKEND_URL || '').trim();
    if (!backendUrl) return '';
    try {
      const parsed = new URL(backendUrl);
      return `${parsed.protocol}//${parsed.hostname}:9000`;
    } catch {
      return '';
    }
  })();

  if (!publicBase) return url;

  return url.replace(/^https?:\/\/[^/]+/i, publicBase);
}

async function initMinIO() {
  if (minioClient) return minioClient;
  if (process.env.SKIP_MINIO === 'true') {
    console.log('MinIO skipped (SKIP_MINIO=true)');
    return null;
  }

  try {
    minioClient = new MinIO.Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT) || 9000,
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
    });

    const bucketExists = await minioClient.bucketExists(BUCKET_NAME);
    if (!bucketExists) {
      await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
      console.log(`Created MinIO bucket: ${BUCKET_NAME}`);
    }

    return minioClient;
  } catch (err) {
    console.warn('MinIO unavailable, screenshots disabled:', err.message);
    minioClient = null;
    return null;
  }
}

function getMinIOClient() {
  return minioClient;
}

async function uploadFile(objectKey, filePath, contentType = 'image/jpeg') {
  const client = getMinIOClient();
  if (!client) {
    const targetPath = getLocalObjectPath(objectKey);
    ensureLocalDir(targetPath);
    fs.copyFileSync(filePath, targetPath);
    return objectKey;
  }
  
  const metaData = {
    'Content-Type': contentType
  };
  
  await client.fPutObject(BUCKET_NAME, objectKey, filePath, metaData);
  
  return `${BUCKET_NAME}/${objectKey}`;
}

async function uploadBuffer(objectKey, buffer, contentType = 'image/jpeg') {
  const client = getMinIOClient();
  if (!client) {
    const targetPath = getLocalObjectPath(objectKey);
    ensureLocalDir(targetPath);
    fs.writeFileSync(targetPath, buffer);
    return objectKey;
  }
  
  await client.putObject(BUCKET_NAME, objectKey, buffer, buffer.length, {
    'Content-Type': contentType
  });
  
  return `${BUCKET_NAME}/${objectKey}`;
}

async function getSignedUrl(objectKey, expirySeconds = 3600) {
  const client = getMinIOClient();
  if (!client) return null;
  
  const url = await client.presignedGetObject(BUCKET_NAME, objectKey, expirySeconds);
  return rewriteSignedUrl(url);
}

async function deleteFile(objectKey) {
  const client = getMinIOClient();
  if (!client) {
    const targetPath = getLocalObjectPath(objectKey);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    return;
  }
  await client.removeObject(BUCKET_NAME, objectKey);
}

async function deleteFiles(objectKeys) {
  const client = getMinIOClient();
  if (!client) {
    for (const objectKey of objectKeys || []) {
      const targetPath = getLocalObjectPath(objectKey);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    }
    return;
  }
  await client.removeObjects(BUCKET_NAME, objectKeys);
}

async function getObjectStream(objectKey) {
  const client = getMinIOClient();
  if (!client) {
    const targetPath = getLocalObjectPath(objectKey);
    if (!fs.existsSync(targetPath)) {
      return null;
    }
    return fs.createReadStream(targetPath);
  }
  return client.getObject(BUCKET_NAME, objectKey);
}

module.exports = {
  initMinIO,
  getMinIOClient,
  getObjectStream,
  getLocalObjectPath,
  uploadFile,
  uploadBuffer,
  getSignedUrl,
  deleteFile,
  deleteFiles,
  BUCKET_NAME
};
