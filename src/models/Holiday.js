/**
 * Holiday model
 * Public/company holidays that affect attendance status.
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const Holiday = sequelize.define('Holiday', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  // Optional: scope to a brand/department. NULL means company-wide.
  brandId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'holidays',
  indexes: [
    { fields: ['date'] },
    { fields: ['brand_id'] }
  ]
});

module.exports = Holiday;
