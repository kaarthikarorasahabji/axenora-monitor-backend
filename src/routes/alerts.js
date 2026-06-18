/**
 * Alert and recording routes
 * Endpoints for alert management and recording control
 */

const express = require('express');
const { Op } = require('sequelize');
const { Alert, Recording, User } = require('../models');
const { getObjectStream } = require('../services/storage');
const { startRecording, stopRecording, getRecordings } = require('../services/recordings');

const router = express.Router();

async function streamStoredObject(res, objectKey, { contentType = 'application/octet-stream', downloadName = null } = {}) {
  try {
    const objectStream = await getObjectStream(objectKey);
    if (!objectStream) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    res.setHeader('Content-Type', contentType);
    if (downloadName) {
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    }
    objectStream.on('error', (error) => {
      console.error('Recording stream error:', error);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to stream recording' });
      } else {
        res.end();
      }
    });
    objectStream.pipe(res);
  } catch (error) {
    console.error('Recording object fetch error:', error);
    return res.status(404).json({ error: 'Recording not found' });
  }
}

// GET /api/alerts - List alerts with pagination and filters
router.get('/alerts', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const offset = (page - 1) * limit;

    const where = {};

    if (req.query.alertType) {
      where.alertType = req.query.alertType;
    }
    if (req.query.severity) {
      where.severity = req.query.severity;
    }
    if (req.query.isRead !== undefined) {
      where.isRead = req.query.isRead === 'true';
    }

    const { count, rows: alerts } = await Alert.findAndCountAll({
      where,
      include: [{
        model: User,
        as: 'employee',
        attributes: ['id', 'name', 'email', 'machineId']
      }],
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    res.json({
      alerts,
      total: count,
      page,
      totalPages: Math.max(Math.ceil(count / limit), 1)
    });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// PUT /api/alerts/read-all - Mark all alerts as read
// NOTE: This must be defined before /alerts/:id/read to avoid route conflict
router.put('/alerts/read-all', async (req, res) => {
  try {
    const [updatedCount] = await Alert.update(
      { isRead: true },
      { where: { isRead: false } }
    );

    res.json({ updated: updatedCount });
  } catch (error) {
    console.error('Mark all alerts read error:', error);
    res.status(500).json({ error: 'Failed to mark alerts as read' });
  }
});

// PUT /api/alerts/:id/read - Mark single alert as read
router.put('/alerts/:id/read', async (req, res) => {
  try {
    const alert = await Alert.findByPk(req.params.id);

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    alert.isRead = true;
    await alert.save();

    res.json(alert);
  } catch (error) {
    console.error('Mark alert read error:', error);
    res.status(500).json({ error: 'Failed to mark alert as read' });
  }
});

// GET /api/employees/:id/recordings - List recordings for an employee
router.get('/employees/:id/recordings', async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await getRecordings(req.params.id, page, limit);
    res.json(result);
  } catch (error) {
    console.error('Get recordings error:', error);
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
});

// POST /api/employees/:id/recordings/start - Start recording
router.post('/employees/:id/recordings/start', async (req, res) => {
  try {
    const employee = await User.findByPk(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const recording = await startRecording(req.params.id, req.user.userId);

    if (employee.machineId) {
      const io = req.app.locals.io;
      if (io) {
        io.to(`agent:${employee.machineId}`).emit('start_recording', {
          recordingId: recording.id,
          quality: 60,
          frame_interval_ms: 1000
        });
        console.log(`Recording started: ${recording.id} → agent:${employee.machineId}`);
      }
    }

    res.status(201).json(recording);
  } catch (error) {
    console.error('Start recording error:', error);
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to start recording' });
  }
});

// POST /api/employees/:id/recordings/stop - Stop recording
router.post('/employees/:id/recordings/stop', async (req, res) => {
  try {
    let { recordingId } = req.body || {};

    if (!recordingId) {
      const activeRecording = await Recording.findOne({
        where: {
          employeeId: req.params.id,
          status: 'recording'
        },
        order: [['startTime', 'DESC']]
      });
      recordingId = activeRecording?.id;
    }

    if (!recordingId) {
      return res.status(404).json({ error: 'No active recording found for this employee' });
    }

    const recording = await stopRecording(recordingId);

    const employee = await User.findByPk(recording.employeeId);
    if (employee && employee.machineId) {
      const io = req.app.locals.io;
      if (io) {
        io.to(`agent:${employee.machineId}`).emit('stop_recording', {
          recordingId: recording.id
        });
        console.log(`Recording stopped: ${recording.id} → agent:${employee.machineId}`);
      }
    }

    res.json(recording);
  } catch (error) {
    console.error('Stop recording error:', error);
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to stop recording' });
  }
});

// GET /api/recordings/:id/file - Stream recording binary through the monitor backend
router.get('/recordings/:id/file', async (req, res) => {
  try {
    const recording = await Recording.findByPk(req.params.id);
    if (!recording?.filePath) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    const fileName = `${recording.employeeId || 'employee'}-${recording.id}.${String(recording.filePath).endsWith('.zip') ? 'zip' : 'webm'}`;
    return streamStoredObject(res, recording.filePath, {
      contentType: String(recording.filePath).endsWith('.zip') ? 'application/zip' : 'video/webm',
      downloadName: fileName,
    });
  } catch (error) {
    console.error('Recording file stream error:', error);
    res.status(500).json({ error: 'Failed to stream recording' });
  }
});

module.exports = router;
