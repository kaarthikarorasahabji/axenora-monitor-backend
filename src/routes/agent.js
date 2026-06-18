/**
 * Agent routes
 * Handles screenshot and activity uploads from agents
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { agentAuth } = require('../middleware/agentAuth');
const { Activity, Screenshot, User, AppCategoryRule } = require('../models');
const { uploadBuffer, deleteFile } = require('../services/storage');
const { setEmployeeOnline, deleteCacheByPrefix, getRedisClient } = require('../services/redis');
const { getSettings } = require('../services/settings');
const { listCategoryRules } = require('../services/categoryRules');
const { logAuditEvent } = require('../services/audit');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${req.agent.machineId}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

const recordingUpload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = new Set([
      'video/webm',
      'video/mp4',
      'application/zip',
      'application/octet-stream',
    ]);
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (allowedMimeTypes.has(file.mimetype) || ['.webm', '.mp4', '.zip'].includes(extension)) {
      cb(null, true);
    } else {
      cb(new Error('Only recording video/archive files are allowed'));
    }
  }
});

// POST /api/agent/screenshot
router.post('/screenshot', agentAuth, upload.single('screenshot'), async (req, res) => {
  let objectKey = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const { agent } = req;
    objectKey = `screenshots/${agent.machineId}/${Date.now()}.jpg`;
    
    // Upload to MinIO
    const fileBuffer = fs.readFileSync(req.file.path);
    await uploadBuffer(objectKey, fileBuffer, 'image/jpeg');
    
    // Save to database
    const screenshot = await Screenshot.create({
      userId: agent.id,
      machineId: agent.machineId,
      filePath: objectKey,
      fileSize: fileBuffer.length,
      timestamp: new Date()
    });
    
    try {
      await setEmployeeOnline(agent.machineId);

      const io = req.app.locals.io;
      if (io) {
        io.to('admins').emit('screenshot_received', {
          userId: agent.id,
          machineId: agent.machineId,
          screenshotId: screenshot.id,
          timestamp: screenshot.timestamp
        });
      }
    } catch (sideEffectError) {
      console.error('Screenshot side-effect error:', sideEffectError);
    }
    
    res.status(200).json({ 
      message: 'Screenshot uploaded',
      id: screenshot.id 
    });
    
  } catch (error) {
    console.error('Screenshot upload error:', error);

    if (objectKey) {
      try {
        await deleteFile(objectKey);
      } catch (cleanupError) {
        console.error('Failed to cleanup screenshot object after upload error:', cleanupError);
      }
    }

    res.status(500).json({ error: 'Failed to upload screenshot' });
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

// POST /api/agent/activity
router.post('/activity', agentAuth, async (req, res) => {
  try {
    const { agent } = req;
    const activityData = req.body;
    
    // Validate required fields
    if (!activityData.timestamp) {
      return res.status(400).json({ error: 'Timestamp required' });
    }
    
    // Save activity
    const activity = await Activity.create({
      userId: agent.id,
      machineId: agent.machineId,
      timestamp: new Date(activityData.timestamp),
      activeApp: activityData.active_app,
      windowTitle: activityData.window_title,
      url: activityData.url,
      idleSeconds: activityData.idle_seconds || 0
    });
    
    await deleteCacheByPrefix(`report:${agent.id}:`);

    try {
      await setEmployeeOnline(agent.machineId);
      
      const io = req.app.locals.io;
      if (io) {
        io.to('admins').emit('activity_update', {
          userId: agent.id,
          machineId: agent.machineId,
          activeApp: activityData.active_app,
          windowTitle: activityData.window_title,
          idleSeconds: activityData.idle_seconds,
          timestamp: activity.timestamp
        });
      }
    } catch (sideEffectError) {
      console.error('Activity side-effect error:', sideEffectError);
    }
    
    res.status(200).json({ 
      message: 'Activity recorded',
      id: activity.id 
    });
    
  } catch (error) {
    console.error('Activity recording error:', error);
    res.status(500).json({ error: 'Failed to record activity' });
  }
});

// GET /api/agent/config
router.get('/config', agentAuth, async (req, res) => {
  try {
    const settings = await getSettings();
    const categoryRules = await listCategoryRules();

    res.status(200).json({
      screenshot_interval_seconds: settings.screenshotIntervalSeconds || parseInt(process.env.SCREENSHOT_INTERVAL_SECONDS) || 30,
      activity_interval_seconds: settings.activityIntervalSeconds || parseInt(process.env.ACTIVITY_INTERVAL_SECONDS) || 10,
      idle_threshold_seconds: settings.idleThresholdSeconds || 60,
      working_hours_start: settings.workingHoursStart || '09:00',
      working_hours_end: settings.workingHoursEnd || '18:00',
      stealth_mode: settings.stealthModeDefault || false,
      break_detection_minutes: settings.breakDetectionMinutes || 5,
      overtime_alert_enabled: settings.overtimeAlertEnabled || true,
      blocked_websites: [],
      blocked_apps: [],
      category_rules: categoryRules.map(r => ({
        keyword: r.keyword,
        category: r.category,
        priority: r.priority
      })),
      server_time: new Date().toISOString()
    });
  } catch (error) {
    console.error('Config fetch error:', error);
    res.status(500).json({ error: 'Failed to get config' });
  }
});

// POST /api/agent/register — Agent self-registration
router.post('/register', async (req, res) => {
  try {
    const { registration_code, machine_id, hostname, os_version, agent_version } = req.body;

    if (!registration_code || !machine_id) {
      return res.status(400).json({ error: 'registration_code and machine_id are required' });
    }

    const redis = getRedisClient();
    const redisKey = `regcode:${registration_code}`;
    const storedEmployeeId = await redis.get(redisKey);

    if (!storedEmployeeId) {
      return res.status(404).json({ error: 'Invalid or expired registration code' });
    }

    const user = await User.findByPk(storedEmployeeId);
    if (!user) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Update machine info
    user.machineId = machine_id;

    // Generate API key if not present
    if (!user.apiKey) {
      user.apiKey = crypto.randomBytes(32).toString('hex');
    }

    await user.save();

    // Delete the registration code after successful use
    await redis.del(redisKey);

    // Log audit event
    await logAuditEvent({
      userId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'agent_registered',
      resourceType: 'user',
      resourceId: String(user.id),
      method: 'POST',
      path: '/api/agent/register',
      ipAddress: req.ip,
      statusCode: 200,
      metadata: { machine_id, hostname, os_version, agent_version }
    });

    const settings = await getSettings();

    res.status(200).json({
      employee_id: user.id,
      employee_name: user.name,
      employee_department: user.department || '',
      api_key: user.apiKey,
      config: settings
    });
  } catch (error) {
    console.error('Agent registration error:', error);
    res.status(500).json({ error: 'Failed to register agent' });
  }
});

// POST /api/agent/recording/upload — Agent uploads a completed recording
router.post('/recording/upload', agentAuth, recordingUpload.single('recording'), async (req, res) => {
  try {
    const { recordingId, frameCount } = req.body;
    if (!recordingId || !req.file) {
      return res.status(400).json({ error: 'recordingId and recording file are required' });
    }

    const { Recording } = require('../models');
    const recording = await Recording.findByPk(recordingId);
    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    if (String(recording.employeeId) !== String(req.agent.id)) {
      return res.status(403).json({ error: 'Recording does not belong to this agent' });
    }

    const fileBuffer = fs.readFileSync(req.file.path);
    const objectKey = `recordings/${recordingId}/${req.file.originalname}`;
    await uploadBuffer(objectKey, fileBuffer, req.file.mimetype || 'video/webm');

    fs.unlinkSync(req.file.path);

    recording.filePath = objectKey;
    recording.fileSize = fileBuffer.length;
    recording.frameCount = parseInt(frameCount, 10) || 0;
    recording.status = 'ready';
    await recording.save();

    console.log(`Recording uploaded: ${recordingId} (${fileBuffer.length} bytes, ${recording.frameCount} frames)`);
    res.json({ status: 'ready', filePath: objectKey });
  } catch (error) {
    console.error('Recording upload error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to upload recording' });
  }
});

// GET /api/agent/version
router.get('/version', (req, res) => {
  res.status(200).json({
    version: '1.0.0',
    download_url: '/api/agent/download'
  });
});

// GET /api/agent/download — Serve the signed Inno Setup installer.
router.get('/download', (req, res) => {
  const distDir = path.join(__dirname, '../../dist');
  const file = 'Axenora-WorkMonitor-Setup.exe';
  const installerPath = path.join(distDir, file);

  if (fs.existsSync(installerPath)) {
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
    res.setHeader('X-Download-Options', 'noopen');
    res.setHeader('Cache-Control', 'no-store');
    return res.download(installerPath, file);
  }

  return res.status(503).json({
    error: 'Inno Setup installer not found. Upload dist/Axenora-WorkMonitor-Setup.exe before enabling onboarding downloads.'
  });
});

module.exports = router;
