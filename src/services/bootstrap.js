const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sequelize, User, Setting, AppCategoryRule } = require('../models');
const { DEFAULT_SETTINGS } = require('./settings');
const { DEFAULT_CATEGORY_RULES } = require('./categoryRules');

async function ensureDefaultSettings() {
  const entries = Object.entries(DEFAULT_SETTINGS);
  await Promise.all(entries.map(([key, value]) => Setting.findOrCreate({
    where: { key },
    defaults: {
      key,
      value,
      description: null
    }
  })));
}

async function ensureDefaultCategoryRules() {
  const count = await AppCategoryRule.count();
  if (count > 0) {
    return;
  }

  await AppCategoryRule.bulkCreate(
    DEFAULT_CATEGORY_RULES.map((rule) => ({
      keyword: rule.keyword,
      category: rule.category,
      priority: rule.priority,
      isActive: rule.isActive
    }))
  );
}

async function ensureSeedAdmin() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminName = process.env.SEED_ADMIN_NAME || 'System Administrator';

  if (!adminEmail || !adminPassword) {
    console.warn('Skipping admin bootstrap because SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD are not set');
    return;
  }

  const existing = await User.findOne({ where: { email: adminEmail } });
  if (existing) {
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await User.create({
    name: adminName,
    email: adminEmail,
    passwordHash,
    role: 'admin',
    isActive: true,
    apiKey: crypto.randomBytes(32).toString('hex')
  });
}

async function bootstrapDatabase() {
  await sequelize.sync({ alter: true });
  await ensureDefaultSettings();
  await ensureDefaultCategoryRules();
  await ensureSeedAdmin();
}

module.exports = {
  bootstrapDatabase
};
