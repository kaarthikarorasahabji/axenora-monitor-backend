/**
 * EmployeeShift model
 * Maps employees to their assigned shifts
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const EmployeeShift = sequelize.define('EmployeeShift', {
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
  shiftId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'shifts',
      key: 'id'
    }
  },
  effectiveFrom: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  effectiveTo: {
    type: DataTypes.DATEONLY,
    allowNull: true
  }
}, {
  tableName: 'employee_shifts',
  indexes: [
    { fields: ['employee_id'] },
    { fields: ['shift_id'] },
    { fields: ['employee_id', 'shift_id'] }
  ]
});

module.exports = EmployeeShift;
