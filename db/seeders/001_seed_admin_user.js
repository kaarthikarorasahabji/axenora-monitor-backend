'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

module.exports = {
  async up(queryInterface, Sequelize) {
    const adminName = process.env.SEED_ADMIN_NAME || 'System Administrator';
    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set before running the admin seeder');
    }

    const passwordHash = await bcrypt.hash(adminPassword, 12);
    
    await queryInterface.bulkInsert('users', [
      {
        id: uuidv4(),
        name: adminName,
        email: adminEmail,
        password_hash: passwordHash,
        role: 'admin',
        machine_id: null,
        api_key: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    ], {});
  },

  async down(queryInterface, Sequelize) {
    if (!process.env.SEED_ADMIN_EMAIL) {
      throw new Error('SEED_ADMIN_EMAIL must be set before rolling back the admin seeder');
    }

    await queryInterface.bulkDelete('users', { email: process.env.SEED_ADMIN_EMAIL }, {});
  }
};
