/**
 * Attendance routes
 * Agent clock-in/out + admin attendance management
 */

const express = require('express');
const { AttendanceDaily } = require('../models');
const {
  clockIn,
  clockOut,
  getAttendanceRecords,
  getAttendanceSummary
} = require('../services/attendance');

// Agent-facing routes (use agentAuth middleware)
const agentRouter = express.Router();

// POST /api/agent/clock-in
agentRouter.post('/clock-in', async (req, res) => {
  try {
    const { machine_id, timestamp } = req.body;

    if (!machine_id || !timestamp) {
      return res.status(400).json({ error: 'machine_id and timestamp are required' });
    }

    const session = await clockIn(req.agent.id, machine_id, timestamp);

    res.status(200).json({
      message: 'Clocked in',
      session
    });
  } catch (error) {
    console.error('Clock-in error:', error);
    res.status(500).json({ error: 'Failed to clock in' });
  }
});

// POST /api/agent/clock-out
agentRouter.post('/clock-out', async (req, res) => {
  try {
    const { machine_id, timestamp } = req.body;

    if (!machine_id || !timestamp) {
      return res.status(400).json({ error: 'machine_id and timestamp are required' });
    }

    const session = await clockOut(req.agent.id, machine_id, timestamp);

    if (!session) {
      return res.status(404).json({ error: 'No open session found for today' });
    }

    res.status(200).json({
      message: 'Clocked out',
      session
    });
  } catch (error) {
    console.error('Clock-out error:', error);
    res.status(500).json({ error: 'Failed to clock out' });
  }
});

// Admin-facing routes (use jwtAuth + requireRole('admin') middleware)
const adminRouter = express.Router();

// GET /api/attendance
adminRouter.get('/attendance', async (req, res) => {
  try {
    const { startDate, endDate, employeeId, status, page, limit } = req.query;

    const result = await getAttendanceRecords({
      startDate,
      endDate,
      employeeId,
      status,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20
    });

    res.json(result);
  } catch (error) {
    console.error('Get attendance records error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance records' });
  }
});

// GET /api/attendance/summary — must be before /attendance/:id to avoid route conflict
adminRouter.get('/attendance/summary', async (req, res) => {
  try {
    const { employeeId, month } = req.query;

    if (!employeeId || !month) {
      return res.status(400).json({ error: 'employeeId and month (YYYY-MM) are required' });
    }

    const summary = await getAttendanceSummary(employeeId, month);
    res.json(summary);
  } catch (error) {
    console.error('Get attendance summary error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance summary' });
  }
});

// PUT /api/attendance/:id — admin manual correction
adminRouter.put('/attendance/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, totalHours } = req.body;

    const daily = await AttendanceDaily.findByPk(id);
    if (!daily) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (totalHours !== undefined) updates.totalHours = totalHours;

    await daily.update(updates);

    res.json({
      message: 'Attendance record updated',
      record: daily
    });
  } catch (error) {
    console.error('Update attendance record error:', error);
    res.status(500).json({ error: 'Failed to update attendance record' });
  }
});

module.exports = { agentRouter, adminRouter };
