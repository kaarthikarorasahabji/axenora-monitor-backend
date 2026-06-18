/**
 * Alert model
 * Tracks employee alerts and notifications
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const Alert = sequelize.define('Alert', {
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
  alertType: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  severity: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'alerts',
  indexes: [
    { fields: ['employee_id'] },
    { fields: ['alert_type'] },
    { fields: ['is_read'] },
    { fields: ['created_at'] }
  ]
});

module.exports = Alert;
