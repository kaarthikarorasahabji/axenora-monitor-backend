/**
 * WebhookDelivery model — durable outbox for outbound webhooks.
 *
 * Any webhook we fire to external systems (CRM attendance mirror today,
 * others later) is enqueued here. A retry worker picks up pending rows
 * and backs off on failure until either success or maxAttempts is hit.
 *
 * Idempotency is the receiver's responsibility — we always send the same
 * `monitor_event_id` (stored in `payload`) on retry.
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const WebhookDelivery = sequelize.define('WebhookDelivery', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  target: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: "Named destination, e.g. 'crm_attendance'",
  },
  url: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  method: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'POST',
  },
  headers: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  },
  payload: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  },
  status: {
    type: DataTypes.ENUM('pending', 'in_flight', 'succeeded', 'failed'),
    allowNull: false,
    defaultValue: 'pending',
  },
  attempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  maxAttempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 5,
  },
  nextAttemptAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  lastError: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  lastStatusCode: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'webhook_deliveries',
  indexes: [
    { fields: ['status', 'next_attempt_at'] },
    { fields: ['target'] },
  ],
});

module.exports = WebhookDelivery;
