/**
 * Recording model
 * Tracks screen recording sessions
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const Recording = sequelize.define('Recording', {
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
  adminId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: false
  },
  endTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  frameCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  filePath: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  fileSize: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('recording', 'processing', 'ready', 'failed'),
    defaultValue: 'recording'
  }
}, {
  tableName: 'recordings',
  indexes: [
    { fields: ['employee_id'] },
    { fields: ['admin_id'] },
    { fields: ['status'] }
  ]
});

module.exports = Recording;
