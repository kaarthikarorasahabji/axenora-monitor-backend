/**
 * Redis service
 * Manages Redis connection and online status tracking
 */

const { createClient } = require('redis');

let redisClient = null;

async function initRedis() {
  if (redisClient) return redisClient;
  
  redisClient = createClient({
    url: process.env.REDIS_URL
  });
  
  redisClient.on('error', (err) => {
    console.error('Redis error:', err);
  });
  
  await redisClient.connect();
  return redisClient;
}

function getRedisClient() {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call initRedis() first.');
  }
  return redisClient;
}

// Online status tracking
const PRESENCE_TTL_SECONDS = Number.parseInt(process.env.PRESENCE_TTL_SECONDS || '60', 10);
const PRESENCE_DISCONNECT_GRACE_SECONDS = Number.parseInt(
  process.env.PRESENCE_DISCONNECT_GRACE_SECONDS || String(PRESENCE_TTL_SECONDS),
  10
);

function safeJsonParse(value) {
  if (!value || value === 'true') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function presenceOnline(meta) {
  if (!meta) return false;
  if (meta.legacy === true) return true;

  const now = Date.now();
  const lastHeartbeatAt = Date.parse(meta.last_heartbeat || meta.updated_at || '');
  const disconnectedAt = Date.parse(meta.disconnected_at || '');
  const heartbeatFresh = Number.isFinite(lastHeartbeatAt)
    ? now - lastHeartbeatAt <= PRESENCE_TTL_SECONDS * 1000
    : true;
  const disconnectedRecently = Number.isFinite(disconnectedAt)
    ? now - disconnectedAt <= PRESENCE_DISCONNECT_GRACE_SECONDS * 1000
    : true;

  return Boolean(heartbeatFresh && (meta.websocket_connected === true || disconnectedRecently));
}

function enrichPresence(machineId, raw) {
  if (raw === 'true') {
    return {
      machine_id: machineId,
      machineId,
      legacy: true,
      websocket_connected: true,
      computed_online_status: true,
      source_of_status: 'legacy_online_key',
      cache_hit: true,
    };
  }

  const parsed = safeJsonParse(raw);
  if (!parsed) return null;

  const lastHeartbeatAt = Date.parse(parsed.last_heartbeat || parsed.updated_at || '');
  const heartbeatAgeSeconds = Number.isFinite(lastHeartbeatAt)
    ? Math.max(0, Math.round((Date.now() - lastHeartbeatAt) / 1000))
    : null;

  return {
    ...parsed,
    machine_id: parsed.machine_id || machineId,
    machineId: parsed.machineId || parsed.machine_id || machineId,
    heartbeat_age_seconds: heartbeatAgeSeconds,
    computed_online_status: presenceOnline(parsed),
    cache_hit: true,
  };
}

async function getEmployeePresence(machineId) {
  const redis = getRedisClient();
  const raw = await redis.get(`online:${machineId}`);
  return enrichPresence(machineId, raw);
}

async function setEmployeeOnline(machineId, ttlSeconds = PRESENCE_TTL_SECONDS, details = {}) {
  if (!machineId) return null;
  const redis = getRedisClient();
  const previous = await getEmployeePresence(machineId);
  const now = new Date().toISOString();
  const payload = {
    ...(previous || {}),
    machine_id: machineId,
    machineId,
    user_id: details.userId || details.user_id || previous?.user_id || null,
    employee_id: details.employeeId || details.employee_id || previous?.employee_id || null,
    agent_id: details.agentId || details.agent_id || previous?.agent_id || null,
    device_id: details.deviceId || details.device_id || machineId,
    socket_id: details.socketId || details.socket_id || previous?.socket_id || null,
    last_heartbeat: now,
    updated_at: now,
    websocket_connected:
      details.websocketConnected ?? details.websocket_connected ?? previous?.websocket_connected ?? true,
    source_of_status: details.source || 'heartbeat',
  };
  delete payload.legacy;
  delete payload.computed_online_status;
  delete payload.heartbeat_age_seconds;
  delete payload.cache_hit;
  delete payload.disconnected_at;
  await redis.set(`online:${machineId}`, JSON.stringify(payload), { EX: ttlSeconds });
  return { ...payload, computed_online_status: true, heartbeat_age_seconds: 0, cache_hit: true };
}

async function markEmployeeDisconnected(machineId, details = {}) {
  if (!machineId) return null;
  const redis = getRedisClient();
  const previous = await getEmployeePresence(machineId);
  const now = new Date().toISOString();
  const payload = {
    ...(previous || {}),
    machine_id: machineId,
    machineId,
    user_id: details.userId || details.user_id || previous?.user_id || null,
    employee_id: details.employeeId || details.employee_id || previous?.employee_id || null,
    agent_id: details.agentId || details.agent_id || previous?.agent_id || null,
    device_id: details.deviceId || details.device_id || machineId,
    socket_id: details.socketId || details.socket_id || previous?.socket_id || null,
    disconnected_at: now,
    updated_at: now,
    websocket_connected: false,
    source_of_status: details.source || 'disconnect_grace',
  };
  delete payload.legacy;
  delete payload.computed_online_status;
  delete payload.heartbeat_age_seconds;
  delete payload.cache_hit;
  await redis.set(`online:${machineId}`, JSON.stringify(payload), { EX: PRESENCE_TTL_SECONDS });
  return enrichPresence(machineId, JSON.stringify(payload));
}

async function setEmployeeOffline(machineId) {
  const redis = getRedisClient();
  await redis.del(`online:${machineId}`);
}

async function isEmployeeOnline(machineId) {
  const presence = await getEmployeePresence(machineId);
  return Boolean(presence?.computed_online_status);
}

async function getOnlineMachineIds() {
  const rows = await getOnlinePresenceList();
  return rows.map((row) => row.machineId || row.machine_id).filter(Boolean);
}

async function getOnlinePresenceList() {
  const redis = getRedisClient();
  const rows = [];

  for await (const key of redis.scanIterator({ MATCH: 'online:*', COUNT: 100 })) {
    const raw = await redis.get(key);
    const machineId = key.replace('online:', '');
    const presence = enrichPresence(machineId, raw);
    if (presence?.computed_online_status) {
      rows.push(presence);
    }
  }

  return rows;
}

// Refresh token management
async function storeRefreshToken(userId, token, ttlSeconds) {
  const redis = getRedisClient();
  await redis.set(`refresh:${userId}`, token, { EX: ttlSeconds });
}

async function getRefreshToken(userId) {
  const redis = getRedisClient();
  return await redis.get(`refresh:${userId}`);
}

async function invalidateRefreshToken(userId) {
  const redis = getRedisClient();
  await redis.del(`refresh:${userId}`);
}

async function blacklistToken(token, ttlSeconds = 3600) {
  const redis = getRedisClient();
  await redis.set(`blacklist:${token}`, 'true', { EX: ttlSeconds });
}

async function getCache(key) {
  const redis = getRedisClient();
  const value = await redis.get(`cache:${key}`);

  if (!value) {
    return null;
  }

  return JSON.parse(value);
}

async function setCache(key, value, ttlSeconds = 300) {
  const redis = getRedisClient();
  await redis.set(`cache:${key}`, JSON.stringify(value), { EX: ttlSeconds });
}

async function deleteCache(key) {
  const redis = getRedisClient();
  await redis.del(`cache:${key}`);
}

async function deleteCacheByPrefix(prefix) {
  const redis = getRedisClient();
  const keys = [];

  for await (const key of redis.scanIterator({ MATCH: `cache:${prefix}*`, COUNT: 100 })) {
    keys.push(key);
  }

  if (keys.length > 0) {
    await redis.del(keys);
  }
}

module.exports = {
  initRedis,
  getRedisClient,
  setEmployeeOnline,
  markEmployeeDisconnected,
  setEmployeeOffline,
  isEmployeeOnline,
  getEmployeePresence,
  getOnlineMachineIds,
  getOnlinePresenceList,
  storeRefreshToken,
  getRefreshToken,
  invalidateRefreshToken,
  blacklistToken,
  getCache,
  setCache,
  deleteCache,
  deleteCacheByPrefix
};
