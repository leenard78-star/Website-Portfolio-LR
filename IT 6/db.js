'use strict';

require('dotenv').config();

const { Pool } = require('pg');

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'pks_resort',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 10
};

const pool = new Pool(config);

if (!config.password || config.password === 'replace_with_your_local_password') {
  console.warn('DB_PASSWORD is not set in .env. Edit .env with your local PostgreSQL password, then restart the server.');
}

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

module.exports = pool;
