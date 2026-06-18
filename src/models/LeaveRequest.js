/**
 * LeaveRequest model
 * Employee leave requests with approval workflow.
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const LeaveRequest = sequelize.define('LeaveRequest', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  employeeId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  fromDate: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  toDate: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  leaveType: {
    type: DataTypes.ENUM('casual', 'sick', 'earned', 'unpaid', 'other'),
    defaultValue: 'casual'
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'cancelled'),
    defaultValue: 'pending'
  },
  reviewedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  reviewedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  reviewNote: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'leave_requests',
  indexes: [
    { fields: ['employee_id'] },
    { fields: ['from_date', 'to_date'] },
    { fields: ['status'] }
  ]
});

module.exports = LeaveRequest;
