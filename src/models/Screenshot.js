/**
 * Screenshot model
 * Stores screenshot metadata and MinIO paths
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const Screenshot = sequelize.define('Screenshot', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  machineId: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  filePath: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'MinIO object key'
  },
  fileSize: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'File size in bytes'
  }
}, {
  tableName: 'screenshots',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['timestamp'] },
    { fields: ['user_id', 'timestamp'] },
    { fields: ['machine_id'] }
  ]
});

module.exports = Screenshot;
