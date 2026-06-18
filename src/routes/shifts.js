/**
 * Shift management routes
 * CRUD for shifts + employee assignment
 */

const express = require('express');
const { Shift, EmployeeShift, User } = require('../models');

const router = express.Router();

// GET /api/shifts — list all shifts with assigned employee count
router.get('/shifts', async (req, res) => {
  try {
    const shifts = await Shift.findAll({
      order: [['name', 'ASC']],
      include: [{
        model: EmployeeShift,
        as: 'employeeShifts',
        attributes: ['id']
      }]
    });

    const result = shifts.map(shift => {
      const json = shift.toJSON();
      const assignedCount = json.employeeShifts ? json.employeeShifts.length : 0;
      delete json.employeeShifts;
      return { ...json, assignedCount };
    });

    res.json({ shifts: result });
  } catch (error) {
    console.error('List shifts error:', error);
    res.status(500).json({ error: 'Failed to fetch shifts' });
  }
});

// POST /api/shifts — create a shift
router.post('/shifts', async (req, res) => {
  try {
    const { name, startTime, endTime, gracePeriodMinutes, breakMinutes, workingDays } = req.body;

    if (!name || !startTime || !endTime) {
      return res.status(400).json({ error: 'name, startTime, and endTime are required' });
    }

    const shift = await Shift.create({
      name,
      startTime,
      endTime,
      gracePeriodMinutes: gracePeriodMinutes || 15,
      breakMinutes: breakMinutes || 0,
      workingDays: workingDays || [1, 2, 3, 4, 5]
    });

    res.status(201).json({
      message: 'Shift created',
      shift
    });
  } catch (error) {
    console.error('Create shift error:', error);
    res.status(500).json({ error: 'Failed to create shift' });
  }
});

// PUT /api/shifts/:id — update a shift
router.put('/shifts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, startTime, endTime, gracePeriodMinutes, breakMinutes, workingDays, isActive } = req.body;

    const shift = await Shift.findByPk(id);
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (startTime !== undefined) updates.startTime = startTime;
    if (endTime !== undefined) updates.endTime = endTime;
    if (gracePeriodMinutes !== undefined) updates.gracePeriodMinutes = gracePeriodMinutes;
    if (breakMinutes !== undefined) updates.breakMinutes = breakMinutes;
    if (workingDays !== undefined) updates.workingDays = workingDays;
    if (isActive !== undefined) updates.isActive = isActive;

    await shift.update(updates);

    res.json({
      message: 'Shift updated',
      shift
    });
  } catch (error) {
    console.error('Update shift error:', error);
    res.status(500).json({ error: 'Failed to update shift' });
  }
});

// DELETE /api/shifts/:id — delete a shift (cascades to employee_shifts)
router.delete('/shifts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const shift = await Shift.findByPk(id);
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    // Delete associated employee_shifts first, then the shift
    await EmployeeShift.destroy({ where: { shiftId: id } });
    await shift.destroy();

    res.json({ message: 'Shift deleted' });
  } catch (error) {
    console.error('Delete shift error:', error);
    res.status(500).json({ error: 'Failed to delete shift' });
  }
});

// POST /api/shifts/:id/assign — assign an employee to a shift
router.post('/shifts/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId, effectiveFrom, effectiveTo } = req.body;

    if (!employeeId || !effectiveFrom) {
      return res.status(400).json({ error: 'employeeId and effectiveFrom are required' });
    }

    // Verify shift exists
    const shift = await Shift.findByPk(id);
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    // Verify employee exists
    const employee = await User.findByPk(employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const employeeShift = await EmployeeShift.create({
      employeeId,
      shiftId: id,
      effectiveFrom,
      effectiveTo: effectiveTo || null
    });

    res.status(201).json({
      message: 'Employee assigned to shift',
      employeeShift
    });
  } catch (error) {
    console.error('Assign shift error:', error);
    res.status(500).json({ error: 'Failed to assign employee to shift' });
  }
});

// DELETE /api/shifts/:id/unassign — remove an employee from a shift
router.delete('/shifts/:id/unassign', async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId } = req.body;

    if (!employeeId) {
      return res.status(400).json({ error: 'employeeId is required' });
    }

    const deleted = await EmployeeShift.destroy({
      where: {
        shiftId: id,
        employeeId
      }
    });

    if (deleted === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json({ message: 'Employee unassigned from shift' });
  } catch (error) {
    console.error('Unassign shift error:', error);
    res.status(500).json({ error: 'Failed to unassign employee from shift' });
  }
});

module.exports = router;
