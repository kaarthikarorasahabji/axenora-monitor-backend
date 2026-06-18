/**
 * In-memory latest-frame cache for live monitoring.
 *
 * The socket server is the only process that receives live frames, so keeping
 * the latest frame in process memory avoids Redis bloat while still allowing
 * REST endpoints to expose fresh metadata for CRM tiles.
 */

const latestFrames = new Map();

function frameSizeBytes(frame) {
  if (!frame) return 0;
  if (Buffer.isBuffer(frame)) return frame.length;
  if (typeof frame === 'string') return Buffer.byteLength(frame, 'base64');
  if (frame instanceof ArrayBuffer) return frame.byteLength;
  if (ArrayBuffer.isView(frame)) return frame.byteLength;
  return 0;
}

function updateLatestFrame(machineId, frame, metadata = {}) {
  if (!machineId || !frame) return null;
  const timestamp = metadata.timestamp || Date.now();
  const entry = {
    machineId,
    frame,
    contentType: metadata.contentType || 'image/jpeg',
    timestamp,
    resolution: metadata.resolution || null,
    monitor: metadata.monitor || 0,
    userId: metadata.userId || null,
    socketId: metadata.socketId || null,
    frameSizeBytes: frameSizeBytes(frame),
  };
  latestFrames.set(machineId, entry);
  return getLatestFrameMeta(machineId);
}

function getLatestFrameMeta(machineId) {
  const entry = latestFrames.get(machineId);
  if (!entry) return null;
  return {
    machineId,
    timestamp: entry.timestamp,
    latestFrameAgeMs: Math.max(0, Date.now() - entry.timestamp),
    contentType: entry.contentType,
    resolution: entry.resolution,
    monitor: entry.monitor,
    frameSizeBytes: entry.frameSizeBytes,
    hasLatestFrame: true,
  };
}

function getLatestFramePayload(machineId) {
  const entry = latestFrames.get(machineId);
  if (!entry) return null;
  return { ...entry, latestFrameAgeMs: Math.max(0, Date.now() - entry.timestamp) };
}

function clearLatestFrame(machineId) {
  if (machineId) latestFrames.delete(machineId);
}

module.exports = {
  updateLatestFrame,
  getLatestFrameMeta,
  getLatestFramePayload,
  clearLatestFrame,
};
