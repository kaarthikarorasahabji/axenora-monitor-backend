/**
 * Sequelize database configuration and model associations
 */

const { sequelize } = require('./sequelize');

// Import models
const User = require('./User');
const Activity = require('./Activity');
const Screenshot = require('./Screenshot');
const Setting = require('./Setting');
const AppCategoryRule = require('./AppCategoryRule');
const AuditLog = require('./AuditLog');
const ApiToken = require('./ApiToken');
const Alert = require('./Alert');
const AttendanceSession = require('./AttendanceSession');
const AttendanceDaily = require('./AttendanceDaily');
const Shift = require('./Shift');
const EmployeeShift = require('./EmployeeShift');
const Recording = require('./Recording');
const BlockedSite = require('./BlockedSite');
const BlockedApp = require('./BlockedApp');
const Holiday = require('./Holiday');
const LeaveRequest = require('./LeaveRequest');
const WebhookDelivery = require('./WebhookDelivery');

// Define associations
User.hasMany(Activity, { foreignKey: 'userId', as: 'activities' });
Activity.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(Screenshot, { foreignKey: 'userId', as: 'screenshots' });
Screenshot.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(AuditLog, { foreignKey: 'userId', as: 'auditLogs' });
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(ApiToken, { foreignKey: 'createdByUserId', as: 'apiTokens' });
ApiToken.belongsTo(User, { foreignKey: 'createdByUserId', as: 'createdBy' });

User.hasMany(Alert, { foreignKey: 'employeeId', as: 'alerts' });
Alert.belongsTo(User, { foreignKey: 'employeeId', as: 'employee' });

User.hasMany(AttendanceSession, { foreignKey: 'employeeId', as: 'attendanceSessions' });
AttendanceSession.belongsTo(User, { foreignKey: 'employeeId', as: 'employee' });

User.hasMany(AttendanceDaily, { foreignKey: 'employeeId', as: 'attendanceDaily' });
AttendanceDaily.belongsTo(User, { foreignKey: 'employeeId', as: 'employee' });

User.hasMany(EmployeeShift, { foreignKey: 'employeeId', as: 'employeeShifts' });
EmployeeShift.belongsTo(User, { foreignKey: 'employeeId', as: 'employee' });
Shift.hasMany(EmployeeShift, { foreignKey: 'shiftId', as: 'employeeShifts' });
EmployeeShift.belongsTo(Shift, { foreignKey: 'shiftId', as: 'shift' });

User.hasMany(Recording, { foreignKey: 'employeeId', as: 'recordings' });
Recording.belongsTo(User, { foreignKey: 'employeeId', as: 'employee' });
Recording.belongsTo(User, { foreignKey: 'adminId', as: 'admin' });

User.hasMany(LeaveRequest, { foreignKey: 'employeeId', as: 'leaveRequests' });
LeaveRequest.belongsTo(User, { foreignKey: 'employeeId', as: 'employee' });

module.exports = {
  sequelize,
  User,
  Activity,
  Screenshot,
  Setting,
  AppCategoryRule,
  AuditLog,
  ApiToken,
  Alert,
  AttendanceSession,
  AttendanceDaily,
  Shift,
  EmployeeShift,
  Recording,
  BlockedSite,
  BlockedApp,
  Holiday,
  LeaveRequest,
  WebhookDelivery
};
