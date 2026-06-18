/**
 * Audit logs for admin and employee access/actions.
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const AuditLog = sequelize.define('AuditLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  actorEmail: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  actorRole: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  action: {
    type: DataTypes.STRING(60),
    allowNull: false
  },
  resourceType: {
    type: DataTypes.STRING(80),
    allowNull: false
  },
  resourceId: {
    type: DataTypes.STRING(120),
    allowNull: true
  },
  method: {
    type: DataTypes.STRING(10),
    allowNull: false
  },
  path: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  ipAddress: {
    type: DataTypes.STRING(120),
    allowNull: true
  },
  statusCode: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {}
  }
}, {
  tableName: 'audit_logs',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['action'] },
    { fields: ['resource_type'] },
    { fields: ['created_at'] }
  ]
});

module.exports = AuditLog;
