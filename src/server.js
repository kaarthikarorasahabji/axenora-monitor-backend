/**
 * Server entry point.
 * Starts HTTP server, Socket.IO, and background retention automation.
 */

const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const { setupSocketIO } = require('./sockets/live');
const { initRedis } = require('./services/redis');
const { initMinIO } = require('./services/storage');
const { bootstrapDatabase } = require('./services/bootstrap');
const { startRetentionScheduler, stopRetentionScheduler } = require('./services/retentionScheduler');
const { runAlertChecks } = require('./services/alerts');
const { startAutoCheckoutScheduler } = require('./services/autoCheckout');
const { startWebhookWorker } = require('./services/webhookQueue');
const { sequelize } = require('./models');

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? process.env.FRONTEND_URL
      : '*',
    credentials: true
  }
});

app.locals.io = io;

async function start() {
  try {
    await initRedis();
    console.log('Redis connected');

    await initMinIO();
    console.log('MinIO connected');

    await sequelize.authenticate();
    console.log('Database connected');

    const dbSchema = process.env.DB_SCHEMA || 'monitor';
    await sequelize.query(`CREATE SCHEMA IF NOT EXISTS "${dbSchema}"`);
    console.log(`Schema "${dbSchema}" ensured`);

    if (process.env.AUTO_BOOTSTRAP_DATABASE !== 'false') {
      await bootstrapDatabase();
      console.log('Database bootstrap complete');
    }

    setupSocketIO(io);
    console.log('WebSocket initialized');

    startRetentionScheduler();
    console.log('Retention scheduler initialized');

    // Run alert checks every 5 minutes
    const alertInterval = setInterval(async () => {
      try {
        await runAlertChecks();
      } catch (err) {
        console.error('Alert check error:', err);
      }
    }, 5 * 60 * 1000);
    app.locals.alertInterval = alertInterval;
    console.log('Alert scheduler initialized (every 5 min)');

    startAutoCheckoutScheduler();
    startWebhookWorker();

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log(`API: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  stopRetentionScheduler();
  server.close(async () => {
    await sequelize.close();
    process.exit(0);
  });
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

start();

module.exports = { io, server };
