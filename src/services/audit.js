const { AuditLog } = require('../models');

async function logAuditEvent({
  userId = null,
  actorEmail = null,
  actorRole = null,
  action,
  resourceType,
  resourceId = null,
  method,
  path,
  ipAddress = null,
  statusCode = null,
  metadata = {}
}) {
  try {
    await AuditLog.create({
      userId,
      actorEmail,
      actorRole,
      action,
      resourceType,
      resourceId,
      method,
      path,
      ipAddress,
      statusCode,
      metadata
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

function inferAction(method) {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'read';
    case 'POST':
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return method.toLowerCase();
  }
}

function inferResourceType(path) {
  const clean = path.split('?')[0].split('/').filter(Boolean);
  if (clean.length === 0) {
    return 'unknown';
  }

  return clean[clean.length - 1];
}

function auditRequest(req, res, next) {
  const startedAt = Date.now();

  res.on('finish', () => {
    if (!req.user) {
      return;
    }

    const durationMs = Date.now() - startedAt;
    const resourceId = req.params.id || req.body?.id || null;

    setImmediate(() => {
      logAuditEvent({
        userId: req.user.userId,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        action: req.auditAction || inferAction(req.method),
        resourceType: req.auditResourceType || inferResourceType(req.path),
        resourceId,
        method: req.method,
        path: req.originalUrl,
        ipAddress: req.ip,
        statusCode: res.statusCode,
        metadata: {
          durationMs,
          query: req.query
        }
      });
    });
  });

  next();
}

module.exports = {
  logAuditEvent,
  auditRequest
};
