/**
 * Recording management service
 * Handles start/stop recording and listing with signed URLs
 */

const { Recording } = require('../models');
const { getSettings } = require('./settings');
const { getSignedUrl } = require('./storage');

/**
 * Start a new screen recording for an employee
 * Enforces maxConcurrentRecordings limit
 */
async function startRecording(employeeId, adminId) {
  const settings = await getSettings();
  const maxConcurrent = settings.maxConcurrentRecordings || 3;

  // Check concurrent recording count
  const activeCount = await Recording.count({
    where: { status: 'recording' }
  });

  if (activeCount >= maxConcurrent) {
    const err = new Error(`Maximum concurrent recordings (${maxConcurrent}) reached`);
    err.status = 429;
    throw err;
  }

  const recording = await Recording.create({
    employeeId,
    adminId,
    status: 'recording',
    startTime: new Date()
  });

  return recording;
}

/**
 * Stop an active recording
 * Sets status to 'processing' so the caller can enqueue an ffmpeg job
 */
async function stopRecording(recordingId) {
  const recording = await Recording.findByPk(recordingId);

  if (!recording) {
    const err = new Error('Recording not found');
    err.status = 404;
    throw err;
  }

  if (recording.status !== 'recording') {
    const err = new Error(`Recording is not active (current status: ${recording.status})`);
    err.status = 400;
    throw err;
  }

  recording.status = 'processing';
  recording.endTime = new Date();
  await recording.save();

  return recording;
}

/**
 * List recordings for an employee with pagination
 * Generates signed URLs for 'ready' recordings
 */
async function getRecordings(employeeId, page = 1, limit = 20) {
  page = Math.max(parseInt(page, 10) || 1, 1);
  limit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const offset = (page - 1) * limit;

  const { count, rows } = await Recording.findAndCountAll({
    where: { employeeId },
    limit,
    offset,
    order: [['startTime', 'DESC']]
  });

  // Generate signed URLs for ready recordings
  const recordings = await Promise.all(
    rows.map(async (rec) => {
      const data = rec.toJSON();
      if (data.status === 'ready' && data.filePath) {
        try {
          data.signedUrl = await getSignedUrl(data.filePath, 3600);
        } catch {
          data.signedUrl = null;
        }
      }
      return data;
    })
  );

  return {
    recordings,
    total: count,
    page,
    totalPages: Math.max(Math.ceil(count / limit), 1)
  };
}

module.exports = {
  startRecording,
  stopRecording,
  getRecordings
};
