/**
 * Agent authentication middleware
 * Validates X-API-Key header for agent routes
 */

const { User } = require('../models');

function normalizeMachineId(value) {
  if (value === undefined || value === null) return null;
  const machineId = String(value).trim();
  if (!machineId || machineId.length < 6 || machineId.length > 128) return null;
  if (!/^[A-Za-z0-9_.:-]+$/.test(machineId)) return null;
  return machineId;
}

function getMachineIdFromRequest(req) {
  return normalizeMachineId(
    req.headers['x-machine-id'] ||
    req.body?.machine_id ||
    req.body?.machineId ||
    req.query?.machine_id ||
    req.query?.machineId
  );
}

async function bindAgentMachine(user, machineId) {
  if (!machineId || user.machineId === machineId) {
    return user;
  }

  const staleUser = await User.findOne({ where: { machineId } });
  if (staleUser && String(staleUser.id) !== String(user.id)) {
    staleUser.machineId = null;
    await staleUser.save({ fields: ['machineId'] });
    console.warn(`Cleared stale machine binding ${machineId} from user ${staleUser.id}`);
  }

  user.machineId = machineId;
  await user.save({ fields: ['machineId'] });
  console.log(`Bound machine ${machineId} to agent user ${user.id}`);
  return user;
}

async function agentAuth(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }
    
    const user = await User.findOne({
      where: { apiKey, isActive: true }
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const machineId = getMachineIdFromRequest(req);
    if (machineId) {
      await bindAgentMachine(user, machineId);
    }
    
    // Attach user to request
    req.agent = user;
    next();
    
  } catch (error) {
    console.error('Agent auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

module.exports = { agentAuth, bindAgentMachine, normalizeMachineId };
