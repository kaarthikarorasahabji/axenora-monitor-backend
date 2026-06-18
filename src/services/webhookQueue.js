/**
 * Webhook retry queue.
 *
 * Enqueue with `enqueueWebhook(...)` from anywhere in the app. A worker
 * started via `startWebhookWorker()` drains the queue every 15 seconds,
 * uses exponential backoff on failure, and gives up after
 * `maxAttempts` tries (default 5).
 *
 * Failures don't block the caller — enqueueing writes one row and
 * returns immediately.
 */

const { Op } = require('sequelize');
const { WebhookDelivery } = require('../models');

const WORKER_INTERVAL_MS = 15 * 1000;
const BATCH_SIZE = 20;
const DEFAULT_MAX_ATTEMPTS = 5;
// Attempt N (0-indexed) waits: 15s, 60s, 4m, 16m, 1h approximately.
const BACKOFF_MS = [15_000, 60_000, 240_000, 960_000, 3_600_000];

let intervalHandle = null;
let draining = false;

/**
 * Enqueue a webhook for durable, retrying delivery.
 * Returns immediately after writing the DB row.
 */
async function enqueueWebhook({ target, url, method = 'POST', headers = {}, payload = {}, maxAttempts }) {
  if (!url) return null;
  try {
    return await WebhookDelivery.create({
      target,
      url,
      method,
      headers,
      payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: maxAttempts || DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: new Date(),
    });
  } catch (err) {
    console.warn(`[webhook-queue] enqueue failed for ${target}: ${err.message}`);
    return null;
  }
}

async function sendOne(row) {
  const started = Date.now();
  try {
    const response = await fetch(row.url, {
      method: row.method,
      headers: { 'Content-Type': 'application/json', ...row.headers },
      body: JSON.stringify(row.payload),
      signal: AbortSignal.timeout(10_000),
    });

    row.lastStatusCode = response.status;

    if (response.status >= 200 && response.status < 300) {
      row.status = 'succeeded';
      row.lastError = null;
      await row.save();
      return true;
    }
    // 4xx (except 408/429) = permanent error, stop retrying.
    if (response.status >= 400 && response.status < 500
        && response.status !== 408 && response.status !== 429) {
      row.status = 'failed';
      row.lastError = `HTTP ${response.status} (non-retryable)`;
      await row.save();
      return false;
    }
    throw new Error(`HTTP ${response.status}`);
  } catch (err) {
    row.attempts += 1;
    row.lastError = err.message || String(err);
    if (row.attempts >= row.maxAttempts) {
      row.status = 'failed';
    } else {
      row.status = 'pending';
      const idx = Math.min(row.attempts, BACKOFF_MS.length - 1);
      row.nextAttemptAt = new Date(Date.now() + BACKOFF_MS[idx]);
    }
    await row.save();
    console.warn(`[webhook-queue] ${row.target} attempt ${row.attempts} failed in ${Date.now() - started}ms: ${row.lastError}`);
    return false;
  }
}

async function drainOnce() {
  if (draining) return;
  draining = true;
  try {
    const rows = await WebhookDelivery.findAll({
      where: {
        status: 'pending',
        nextAttemptAt: { [Op.lte]: new Date() },
      },
      order: [['nextAttemptAt', 'ASC']],
      limit: BATCH_SIZE,
    });
    for (const row of rows) {
      row.status = 'in_flight';
      await row.save();
      await sendOne(row);
    }
  } catch (err) {
    console.error('[webhook-queue] drain error:', err);
  } finally {
    draining = false;
  }
}

function startWebhookWorker() {
  if (intervalHandle) return;
  intervalHandle = setInterval(drainOnce, WORKER_INTERVAL_MS);
  drainOnce();
  console.log(`Webhook retry worker started (every ${WORKER_INTERVAL_MS / 1000}s)`);
}

function stopWebhookWorker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { enqueueWebhook, drainOnce, startWebhookWorker, stopWebhookWorker };
