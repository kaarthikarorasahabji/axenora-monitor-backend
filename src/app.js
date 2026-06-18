/**
 * Express application setup
 * Configures middleware, routes, and error handling
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Sequelize } = require('sequelize');

// Import routes
const agentRoutes = require('./routes/agent');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const selfRoutes = require('./routes/self');
const integrationsRoutes = require('./routes/integrations');
const alertRoutes = require('./routes/alerts');
const { agentRouter: attendanceAgentRoutes, adminRouter: attendanceAdminRoutes } = require('./routes/attendance');
const shiftRoutes = require('./routes/shifts');

// Import middleware
const { jwtAuth, requireRole } = require('./middleware/jwtAuth');
const { auditRequest } = require('./services/audit');

// Create Express app
const app = express();
app.set('trust proxy', 1);

// Security headers — allow iframe embedding from CRM
app.use(helmet({
  frameguard: false,
  contentSecurityPolicy: false,
}));

// CORS — allow CRM + own frontend
const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.CRM_ORIGIN,
  ...envOrigins,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`), false);
  },
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  skip: (req) => req.originalUrl.startsWith('/api/agent/'),
  message: 'Too many requests from this IP, please try again later.'
});

const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200, // Higher limit for agents
  message: 'Too many requests from this agent.'
});

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.'
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/embed-login', loginLimiter);
app.use('/api/agent/', agentLimiter);

// Health check
const healthHandler = (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/agent', require('./middleware/agentAuth').agentAuth, attendanceAgentRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/self', jwtAuth, auditRequest, selfRoutes);
app.use('/api/admin', jwtAuth, requireRole('admin'), auditRequest, adminRoutes);

// Sprint 2+3 admin routes
app.use('/api', jwtAuth, requireRole('admin'), auditRequest, alertRoutes);
app.use('/api', jwtAuth, requireRole('admin'), auditRequest, attendanceAdminRoutes);
app.use('/api', jwtAuth, requireRole('admin'), auditRequest, shiftRoutes);

// Dashboard routes require an authenticated admin session.
app.use('/api', jwtAuth, requireRole('admin'), auditRequest, dashboardRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({ 
      error: 'Validation error', 
      details: err.errors.map(e => e.message) 
    });
  }
  
  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ 
      error: 'Conflict', 
      details: err.errors.map(e => e.message) 
    });
  }
  
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal server error' 
  });
});

module.exports = app;
