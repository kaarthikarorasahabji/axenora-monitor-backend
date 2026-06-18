/**
 * WebSocket live handler
 * Real-time screen sharing + online/offline tracking + instant alerts
 */

const jwt = require('jsonwebtoken');
const {
  setEmployeeOnline,
  markEmployeeDisconnected,
  setEmployeeOffline,
  isEmployeeOnline,
  getOnlinePresenceList
} = require('../services/redis');
const { updateLatestFrame, clearLatestFrame } = require('../services/liveFrames');
const { User } = require('../models');
const { checkRealtimeBlacklist, createIdleAlert } = require('../services/alerts');
const { clockIn, clockOut } = require('../services/attendance');
const { bindAgentMachine, normalizeMachineId } = require('../middleware/agentAuth');

// Track which admins are watching which agents.
// liveWatchers: machineId -> Map<socketId, { mode, intervalMs, lastSentAt }>
//   mode = 'detail' (focused single user — high FPS)
//        | 'tile'   (wall thumbnail — low FPS)
// The agent is told to capture at the *fastest* interval any watcher wants.
// Each watcher then receives frames throttled to its own intervalMs so a
// 1 FPS tile watcher never gets the 10 FPS firehose meant for the detail view.
const liveWatchers = new Map();
const MAX_WATCHERS_PER_AGENT = 5;
const LEGACY_FRAME_INTERVAL_MS = Number.parseInt(
  process.env.LEGACY_LIVE_FRAME_INTERVAL_MS || '500',
  10
);
const lastLegacyFrameAt = new Map();
const pendingOfflineTimers = new Map();
const PRESENCE_TTL_SECONDS = Number.parseInt(process.env.PRESENCE_TTL_SECONDS || '60', 10);
const PRESENCE_DISCONNECT_GRACE_SECONDS = Number.parseInt(
  process.env.PRESENCE_DISCONNECT_GRACE_SECONDS || String(PRESENCE_TTL_SECONDS),
  10
);
const LIVE_FRAME_LOG_INTERVAL_MS = Number.parseInt(process.env.LIVE_FRAME_LOG_INTERVAL_MS || '10000', 10);
const lastFrameLogAt = new Map();

// Per-mode capture cadence + JPEG quality. Agents use these to throttle their
// screen capture loop; clients use the matching emit cadence below.
const MODE_CONFIG = {
  detail: {
    captureIntervalMs: Number.parseInt(process.env.LIVE_DETAIL_INTERVAL_MS || '110', 10), // ~9 FPS
    emitIntervalMs:    Number.parseInt(process.env.LIVE_DETAIL_INTERVAL_MS || '110', 10),
    quality:           Number.parseInt(process.env.LIVE_DETAIL_QUALITY || '60', 10),
  },
  tile: {
    captureIntervalMs: Number.parseInt(process.env.LIVE_TILE_INTERVAL_MS || '1500', 10),  // ~0.66 FPS
    emitIntervalMs:    Number.parseInt(process.env.LIVE_TILE_INTERVAL_MS || '1500', 10),
    quality:           Number.parseInt(process.env.LIVE_TILE_QUALITY || '40', 10),
  },
};

function modeFor(input) {
  return input === 'detail' ? 'detail' : 'tile';
}

function computeAgentDirectiveForMachine(machineId) {
  const watchers = liveWatchers.get(machineId);
  if (!watchers || watchers.size === 0) return null;
  // Use the fastest (smallest) interval any watcher needs and the highest
  // quality requested — we can always downsample/throttle per-watcher on
  // emit, but we cannot upsample frames the agent never captured.
  let minInterval = Number.POSITIVE_INFINITY;
  let maxQuality = 0;
  for (const meta of watchers.values()) {
    if (meta.captureIntervalMs < minInterval) minInterval = meta.captureIntervalMs;
    if (meta.quality > maxQuality) maxQuality = meta.quality;
  }
  if (!Number.isFinite(minInterval)) return null;
  return { frame_interval_ms: minInterval, quality: maxQuality || 55 };
}

function toBase64Frame(frame) {
  if (!frame) return null;
  if (typeof frame === 'string') return frame;
  if (Buffer.isBuffer(frame)) return frame.toString('base64');
  if (frame instanceof ArrayBuffer) return Buffer.from(frame).toString('base64');
  if (ArrayBuffer.isView(frame)) {
    return Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength).toString('base64');
  }
  return null;
}

function clearPendingOffline(machineId) {
  const timer = pendingOfflineTimers.get(machineId);
  if (timer) {
    clearTimeout(timer);
    pendingOfflineTimers.delete(machineId);
  }
}

function logPresence(event, payload) {
  try {
    console.log(JSON.stringify({ event, ...payload }));
  } catch {
    console.log(`${event}: ${payload?.machineId || ''}`);
  }
}

function logFrameReceived(machineId, payload) {
  const now = Date.now();
  const last = lastFrameLogAt.get(machineId) || 0;
  if (now - last < LIVE_FRAME_LOG_INTERVAL_MS) return;
  lastFrameLogAt.set(machineId, now);
  logPresence('frame_received', payload);
}

function getSocketMachineId(socket, data = null) {
  const auth = socket.handshake.auth || {};
  const query = socket.handshake.query || {};
  return normalizeMachineId(
    data?.machineId ||
    data?.machine_id ||
    auth.machineId ||
    auth.machine_id ||
    query.machineId ||
    query.machine_id
  );
}

async function ensureSocketMachine(socket, data = null) {
  if (socket.role !== 'agent') return socket.user?.machineId || null;

  const machineId = getSocketMachineId(socket, data);
  if (machineId && socket.user?.machineId !== machineId) {
    socket.user.machineId = machineId;
    if (socket.agentRecord) {
      await bindAgentMachine(socket.agentRecord, machineId);
    }
    socket.join(`agent:${machineId}`);
  }

  return socket.user?.machineId || null;
}

function setupSocketIO(io) {
  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      const apiKey = socket.handshake.auth.apiKey;

      if (token) {
        if (process.env.INTEGRATION_API_KEY && token === process.env.INTEGRATION_API_KEY) {
          socket.user = {
            userId: 'crm-integration',
            name: 'CRM Integration'
          };
        } else {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          socket.user = decoded;
        }
        socket.role = 'admin';
      } else if (apiKey) {
        const user = await User.findOne({ where: { apiKey, isActive: true } });
        if (!user) return next(new Error('Invalid API key'));

        const machineId = getSocketMachineId(socket) || user.machineId;
        if (machineId) {
          await bindAgentMachine(user, machineId);
        }

        socket.agentRecord = user;
        socket.user = {
          userId: user.id,
          machineId: user.machineId || machineId,
          name: user.name
        };
        socket.role = 'agent';
      } else {
        return next(new Error('Authentication required'));
      }

      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`WebSocket connected: ${socket.role} - ${socket.user.userId}`);

    if (socket.role === 'admin') {
      socket.join('admins');
      handleAdminConnect(socket, io);
    } else if (socket.role === 'agent') {
      if (socket.user.machineId) {
        socket.join(`agent:${socket.user.machineId}`);
      }
      handleAgentConnect(io, socket);
    }

    socket.on('disconnect', () => {
      if (socket.role === 'agent') {
        handleAgentDisconnect(io, socket);
      } else if (socket.role === 'admin') {
        cleanupAdminWatcher(socket, io);
      }
      console.log(`WebSocket disconnected: ${socket.role} - ${socket.user.userId}`);
    });

    // ── Agent events ──

    // Live screen frame from agent (legacy base64 path)
    socket.on('screen_frame', async (data) => {
      if (socket.role !== 'agent') return;

      const machineId = await ensureSocketMachine(socket, data);
      if (!machineId) return;
      const wasOnline = await isEmployeeOnline(machineId);
      await setEmployeeOnline(machineId, PRESENCE_TTL_SECONDS, {
        userId: socket.user.userId,
        employeeId: socket.user.userId,
        agentId: socket.user.userId,
        deviceId: machineId,
        socketId: socket.id,
        source: 'frame',
        websocketConnected: true,
      });
      clearPendingOffline(machineId);
      if (!wasOnline) {
        io.to('admins').emit('employee_online', {
          machineId,
          userId: socket.user.userId,
          name: socket.user.name,
          timestamp: Date.now(),
          source: 'frame',
        });
      }
      const latestMeta = updateLatestFrame(machineId, data.frame, {
        timestamp: Date.now(),
        contentType: 'image/jpeg',
        resolution: data.resolution || null,
        monitor: data.monitor || 0,
        userId: socket.user.userId,
        socketId: socket.id,
      });
      const watchers = liveWatchers.get(machineId);
      logFrameReceived(machineId, {
        frame_user_id: socket.user.userId,
        frame_agent_id: socket.user.userId,
        frame_device_id: machineId,
        socket_id: socket.id,
        frame_size_bytes: latestMeta?.frameSizeBytes || 0,
        frame_timestamp: latestMeta?.timestamp || Date.now(),
        latest_frame_age_ms: latestMeta?.latestFrameAgeMs || 0,
        broadcast_viewer_count: watchers?.size || 0,
        transport: 'base64',
      });

      if (watchers && watchers.size > 0) {
        const timestamp = Date.now();
        for (const [watcherSocketId, meta] of watchers.entries()) {
          if (timestamp - (meta.lastSentAt || 0) < meta.emitIntervalMs) continue;
          meta.lastSentAt = timestamp;
          io.to(watcherSocketId).emit(`live_frame:${machineId}`, {
            machineId,
            frame: data.frame,
            timestamp,
            resolution: data.resolution || null,
            monitor: data.monitor || 0
          });
        }
      }
    });

    // Live screen frame from agent (preferred binary path — ~30% smaller, faster)
    socket.on('screen_frame_bin', async (data) => {
      if (socket.role !== 'agent') return;

      const machineId = await ensureSocketMachine(socket, data);
      if (!machineId) return;
      const wasOnline = await isEmployeeOnline(machineId);
      await setEmployeeOnline(machineId, PRESENCE_TTL_SECONDS, {
        userId: socket.user.userId,
        employeeId: socket.user.userId,
        agentId: socket.user.userId,
        deviceId: machineId,
        socketId: socket.id,
        source: 'frame',
        websocketConnected: true,
      });
      clearPendingOffline(machineId);
      if (!wasOnline) {
        io.to('admins').emit('employee_online', {
          machineId,
          userId: socket.user.userId,
          name: socket.user.name,
          timestamp: Date.now(),
          source: 'frame',
        });
      }
      const latestMeta = updateLatestFrame(machineId, data.frame, {
        timestamp: Date.now(),
        contentType: data.contentType || 'image/jpeg',
        resolution: data.resolution || null,
        monitor: data.monitor || 0,
        userId: socket.user.userId,
        socketId: socket.id,
      });
      const watchers = liveWatchers.get(machineId);
      logFrameReceived(machineId, {
        frame_user_id: socket.user.userId,
        frame_agent_id: socket.user.userId,
        frame_device_id: machineId,
        socket_id: socket.id,
        frame_size_bytes: latestMeta?.frameSizeBytes || 0,
        frame_timestamp: latestMeta?.timestamp || Date.now(),
        latest_frame_age_ms: latestMeta?.latestFrameAgeMs || 0,
        broadcast_viewer_count: watchers?.size || 0,
        transport: 'binary',
      });

      if (watchers && watchers.size > 0) {
        const timestamp = Date.now();
        const payload = {
          machineId,
          frame: data.frame,
          contentType: data.contentType || 'image/jpeg',
          timestamp,
          resolution: data.resolution || null,
          monitor: data.monitor || 0
        };
        // Per-watcher throttle: detail watchers see ~9 FPS; tile watchers
        // see ~0.66 FPS even though the agent is firing at 9 FPS for the
        // detail watcher in the same room.
        let anySent = false;
        for (const [watcherSocketId, meta] of watchers.entries()) {
          if (timestamp - (meta.lastSentAt || 0) < meta.emitIntervalMs) continue;
          meta.lastSentAt = timestamp;
          anySent = true;
          io.to(watcherSocketId).emit(`live_frame_bin:${machineId}`, payload);
        }

        // Compatibility fallback for already-open CRM tabs running older bundles.
        // Only bother decoding the legacy base64 if at least one watcher
        // was actually emitted to this tick.
        if (anySent) {
          const lastLegacyAt = lastLegacyFrameAt.get(machineId) || 0;
          if (timestamp - lastLegacyAt >= LEGACY_FRAME_INTERVAL_MS) {
            const legacyFrame = toBase64Frame(data.frame);
            if (legacyFrame) {
              lastLegacyFrameAt.set(machineId, timestamp);
              const legacyPayload = {
                machineId,
                frame: legacyFrame,
                timestamp,
                resolution: data.resolution || null,
                monitor: data.monitor || 0
              };
              for (const [watcherSocketId, meta] of watchers.entries()) {
                // Same per-watcher throttle for the legacy event.
                if (meta.lastSentAt !== timestamp) continue;
                io.to(watcherSocketId).emit(`live_frame:${machineId}`, legacyPayload);
              }
            }
          }
        }
      }
    });

    // Agent reports active app/site change → instant blacklist check
    socket.on('app_change', async (data) => {
      if (socket.role !== 'agent') return;

      await ensureSocketMachine(socket, data);
      const { userId, machineId, name } = socket.user;
      if (!machineId) return;

      // Broadcast to admins
      io.to('admins').emit('employee_app_change', {
        machineId,
        userId,
        name,
        activeApp: data.activeApp,
        windowTitle: data.windowTitle,
        url: data.url || null,
        timestamp: Date.now()
      });

      // Real-time blacklist check
      try {
        const alert = await checkRealtimeBlacklist(
          userId, name, machineId,
          data.activeApp, data.url || null
        );

        if (alert) {
          // Instant alert to all admins
          io.to('admins').emit('realtime_alert', {
            id: alert.id,
            alertType: alert.alertType,
            severity: alert.severity,
            message: alert.message,
            employeeName: name,
            machineId,
            metadata: alert.metadata,
            timestamp: Date.now()
          });
          console.log(`REALTIME ALERT: ${alert.message}`);
        }
      } catch (err) {
        console.error('Realtime blacklist check error:', err.message);
      }
    });

    // Agent reports idle threshold exceeded
    socket.on('idle_alert', async (data) => {
      if (socket.role !== 'agent') return;

      await ensureSocketMachine(socket, data);
      const { userId, machineId, name } = socket.user;
      if (!machineId) return;
      const idleMinutes = data.idle_minutes || 15;

      try {
        const alert = await createIdleAlert(userId, name, machineId, idleMinutes);

        if (alert) {
          io.to('admins').emit('realtime_alert', {
            id: alert.id,
            alertType: 'idle',
            severity: 'medium',
            message: alert.message,
            employeeName: name,
            machineId,
            metadata: alert.metadata,
            timestamp: Date.now()
          });
          console.log(`REALTIME ALERT: ${alert.message}`);
        }
      } catch (err) {
        console.error('Idle alert error:', err.message);
      }
    });

    // Agent reports user returned from idle
    socket.on('idle_ended', async (data) => {
      if (socket.role !== 'agent') return;

      await ensureSocketMachine(socket, data);
      if (!socket.user.machineId) return;
      io.to('admins').emit('employee_active_again', {
        machineId: socket.user.machineId,
        userId: socket.user.userId,
        name: socket.user.name,
        idleMinutes: data.idle_minutes || 0,
        timestamp: Date.now()
      });
    });

    // Agent heartbeat
    socket.on('heartbeat', async (data) => {
      if (socket.role !== 'agent') return;

      const machineId = await ensureSocketMachine(socket, data);
      if (!machineId) {
        socket.emit('heartbeat_ack', {
          timestamp: Date.now(),
          live_mode: false,
          frame_interval_ms: 0,
          error: 'machine_id_required'
        });
        return;
      }

      const wasOnline = await isEmployeeOnline(machineId);
      const presence = await setEmployeeOnline(machineId, PRESENCE_TTL_SECONDS, {
        userId: socket.user.userId,
        employeeId: socket.user.userId,
        agentId: socket.user.userId,
        deviceId: machineId,
        socketId: socket.id,
        source: 'heartbeat',
        websocketConnected: true,
      });
      clearPendingOffline(machineId);
      if (!wasOnline) {
        io.to('admins').emit('employee_online', {
          machineId,
          userId: socket.user.userId,
          name: socket.user.name,
          timestamp: Date.now(),
          source: 'heartbeat',
        });
      }
      logPresence('agent_presence_update', {
        user_id: socket.user.userId,
        employee_id: socket.user.userId,
        agent_id: socket.user.userId,
        device_id: machineId,
        socket_id: socket.id,
        last_heartbeat: presence?.last_heartbeat,
        heartbeat_age_seconds: presence?.heartbeat_age_seconds || 0,
        websocket_connected: true,
        computed_online_status: true,
        cache_hit: true,
        source_of_status: 'heartbeat',
      });

      const directive = computeAgentDirectiveForMachine(machineId);
      const isBeingWatched = directive !== null;

      socket.emit('heartbeat_ack', {
        timestamp: Date.now(),
        live_mode: isBeingWatched,
        frame_interval_ms: isBeingWatched ? directive.frame_interval_ms : 0,
        quality: isBeingWatched ? directive.quality : 0
      });
    });

    // ── Admin events ──

    socket.on('watch_live', (data) => {
      if (socket.role !== 'admin') return;

      const { machineId } = data;
      if (!machineId) return;

      if (!liveWatchers.has(machineId)) {
        liveWatchers.set(machineId, new Map());
      }

      const watchers = liveWatchers.get(machineId);

      // Same socket re-emitting watch_live (e.g. mode upgrade tile -> detail)
      // should NOT count toward the watcher cap.
      if (!watchers.has(socket.id) && watchers.size >= MAX_WATCHERS_PER_AGENT) {
        socket.emit('watch_live_error', {
          machineId,
          error: `Maximum ${MAX_WATCHERS_PER_AGENT} concurrent watchers reached`
        });
        return;
      }

      const mode = modeFor(data.mode);
      const cfg = MODE_CONFIG[mode];
      watchers.set(socket.id, {
        mode,
        captureIntervalMs: cfg.captureIntervalMs,
        emitIntervalMs: cfg.emitIntervalMs,
        quality: cfg.quality,
        lastSentAt: 0,
      });

      const directive = computeAgentDirectiveForMachine(machineId);
      if (directive) {
        io.to(`agent:${machineId}`).emit('start_live', directive);
      }

      socket.emit('watch_live_started', {
        machineId,
        mode,
        watcherCount: watchers.size,
        emitIntervalMs: cfg.emitIntervalMs,
      });

      console.log(
        `Admin ${socket.user.userId} watching ${machineId} mode=${mode} ` +
        `interval=${cfg.captureIntervalMs}ms (${watchers.size} watchers)`
      );
    });

    socket.on('stop_live', (data) => {
      if (socket.role !== 'admin') return;

      const { machineId } = data;
      if (!machineId) return;

      removeWatcher(socket, machineId, io);
    });
  });
}

function removeWatcher(socket, machineId, io) {
  const watchers = liveWatchers.get(machineId);
  if (!watchers) return;

  watchers.delete(socket.id);

  if (watchers.size === 0) {
    liveWatchers.delete(machineId);
    io.to(`agent:${machineId}`).emit('stop_live');
  }

  socket.emit('watch_live_stopped', { machineId });
}

function cleanupAdminWatcher(socket, io) {
  for (const [machineId, watchers] of liveWatchers.entries()) {
    if (watchers.has(socket.id)) {
      watchers.delete(socket.id);
      if (watchers.size === 0) {
        liveWatchers.delete(machineId);
        io.to(`agent:${machineId}`).emit('stop_live');
      }
    }
  }
}

async function handleAdminConnect(socket, io) {
  socket.emit('admins_ready', { timestamp: Date.now() });
  try {
    const presences = await getOnlinePresenceList();
    if (presences.length === 0) {
      socket.emit('online_snapshot', { employees: [], timestamp: Date.now() });
      return;
    }
    const machineIds = presences.map((row) => row.machineId || row.machine_id).filter(Boolean);
    const presenceByMachine = new Map(presences.map((row) => [row.machineId || row.machine_id, row]));
    const users = await User.findAll({
      where: { machineId: machineIds },
      attributes: ['id', 'machineId', 'name']
    });
    socket.emit('online_snapshot', {
      employees: users.map((u) => ({
        machineId: u.machineId,
        userId: u.id,
        name: u.name,
        presence: presenceByMachine.get(u.machineId) || null,
      })),
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('online_snapshot error:', err.message);
  }
}

async function handleAgentConnect(io, socket) {
  const { machineId, userId } = socket.user;
  if (!machineId) {
    socket.emit('agent_config_error', { error: 'machine_id_required' });
    return;
  }
  const wasOnline = await isEmployeeOnline(machineId);

  const presence = await setEmployeeOnline(machineId, PRESENCE_TTL_SECONDS, {
    userId,
    employeeId: userId,
    agentId: userId,
    deviceId: machineId,
    socketId: socket.id,
    source: 'connect',
    websocketConnected: true,
  });
  clearPendingOffline(machineId);

  if (!wasOnline) {
    io.to('admins').emit('employee_online', {
      machineId,
      userId,
      name: socket.user.name,
      timestamp: Date.now(),
      source: 'connect',
    });
  }
  logPresence('agent_presence_update', {
    user_id: userId,
    employee_id: userId,
    agent_id: userId,
    device_id: machineId,
    socket_id: socket.id,
    last_heartbeat: presence?.last_heartbeat,
    heartbeat_age_seconds: presence?.heartbeat_age_seconds || 0,
    websocket_connected: true,
    computed_online_status: true,
    cache_hit: true,
    source_of_status: 'connect',
  });

  // Ensure auto-attendance on every authenticated agent start/reconnect.
  // clockIn is idempotent for an already-open day session, so this safely
  // handles stale Redis online state, HF restarts, sleep/wake, and reconnects.
  try {
    await clockIn(userId, machineId, new Date().toISOString());
    console.log(`Auto clock-in ensured: ${socket.user.name} (${machineId})`);
  } catch (err) {
    console.warn(`Auto clock-in failed for ${userId}: ${err.message}`);
  }

  const directive = computeAgentDirectiveForMachine(machineId);
  if (directive) {
    socket.emit('start_live', directive);
  }
}

async function handleAgentDisconnect(io, socket) {
  const { machineId, userId } = socket.user;
  if (!machineId) return;

  const presence = await markEmployeeDisconnected(machineId, {
    userId,
    employeeId: userId,
    agentId: userId,
    deviceId: machineId,
    socketId: socket.id,
    source: 'disconnect_grace',
  });
  logPresence('agent_presence_update', {
    user_id: userId,
    employee_id: userId,
    agent_id: userId,
    device_id: machineId,
    socket_id: socket.id,
    last_heartbeat: presence?.last_heartbeat,
    heartbeat_age_seconds: presence?.heartbeat_age_seconds,
    websocket_connected: false,
    computed_online_status: presence?.computed_online_status,
    cache_hit: true,
    source_of_status: 'disconnect_grace',
  });

  clearPendingOffline(machineId);
  pendingOfflineTimers.set(machineId, setTimeout(async () => {
    try {
      if (await isEmployeeOnline(machineId)) {
        return;
      }

      await setEmployeeOffline(machineId);
      clearLatestFrame(machineId);

      try {
        await clockOut(userId, machineId, new Date().toISOString());
        console.log(`Auto clock-out after grace: ${socket.user.name} (${machineId})`);
      } catch (err) {
        console.warn(`Auto clock-out failed for ${userId}: ${err.message}`);
      }

      const watchers = liveWatchers.get(machineId);
      if (watchers) {
        for (const watcherSocketId of watchers.keys()) {
          io.to(watcherSocketId).emit('live_stream_ended', { machineId });
        }
        liveWatchers.delete(machineId);
      }

      io.to('admins').emit('employee_offline', {
        machineId,
        userId,
        name: socket.user.name,
        timestamp: Date.now(),
        source: 'disconnect_grace_expired',
      });
      logPresence('agent_presence_update', {
        user_id: userId,
        employee_id: userId,
        agent_id: userId,
        device_id: machineId,
        socket_id: socket.id,
        last_heartbeat: presence?.last_heartbeat,
        heartbeat_age_seconds: PRESENCE_DISCONNECT_GRACE_SECONDS,
        websocket_connected: false,
        computed_online_status: false,
        cache_hit: false,
        source_of_status: 'disconnect_grace_expired',
      });
    } catch (err) {
      console.error(`Offline grace handler failed for ${machineId}:`, err.message);
    } finally {
      pendingOfflineTimers.delete(machineId);
    }
  }, (PRESENCE_DISCONNECT_GRACE_SECONDS + 1) * 1000));
}

module.exports = { setupSocketIO };
