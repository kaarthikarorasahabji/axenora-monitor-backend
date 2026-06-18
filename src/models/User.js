/**
 * User model
 * Represents admin and employee users
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');
const crypto = require('crypto');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING(200),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  passwordHash: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('admin', 'employee'),
    defaultValue: 'employee'
  },
  department: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Job role / department'
  },
  brand: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Brand this employee belongs to (e.g. thai_naturals, kerala, monk_pack). Used for multi-brand grouping in dashboards and reports.'
  },
  machineId: {
    type: DataTypes.STRING(100),
    unique: true,
    allowNull: true
  },
  apiKey: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: true,
    defaultValue: () => crypto.randomBytes(32).toString('hex')
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  twoFactorEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  twoFactorSecret: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  timezone: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'Asia/Kolkata',
    comment: 'IANA timezone for attendance/dashboard display'
  }
}, {
  tableName: 'users',
  indexes: [
    { fields: ['machine_id'] },
    { fields: ['api_key'] },
    { fields: ['email'] },
    { fields: ['two_factor_enabled'] },
    { fields: ['brand'] }
  ]
});

module.exports = User;
