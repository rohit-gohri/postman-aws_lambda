/* global BigInt */
import cfg from '@smpx/cfg';

const STAT_DB_NAME = cfg('statDb', 'CLOUD_WATCH_STATS');
const STAT_TABLE_NAME = 'DB_SIZE';
const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_WEEK = 7 * ONE_DAY;

/**
 * @param {import('knex')} connection
 */
async function initDatabases(connection) {
  await connection.raw(`
    CREATE DATABASE IF NOT EXISTS ${STAT_DB_NAME};
  `);
  await connection.raw(`
    CREATE TABLE IF NOT EXISTS ${STAT_DB_NAME}.${STAT_TABLE_NAME} (
    \`DATE\` datetime not null,
    \`SIZE\` bigint(21) unsigned DEFAULT NULL,
    PRIMARY KEY(DATE)
    ) ENGINE=INNODB DEFAULT CHARSET=utf8;
  `);
  await connection.raw(`
    INSERT INTO ${STAT_DB_NAME}.${STAT_TABLE_NAME}
    SELECT NOW(),
    sum(DATA_LENGTH + INDEX_LENGTH)
    FROM  INFORMATION_SCHEMA.TABLES;
  `);

  const lastWeek = await connection.table(`${STAT_DB_NAME}.${STAT_TABLE_NAME}`)
    .where('DATE', '>', new Date(Date.now() - ONE_WEEK).toISOString())
    .orderBy('DATE', 'asc')
    .limit(1)
    .first()
    .select('*');

  const current = await connection.table(`${STAT_DB_NAME}.${STAT_TABLE_NAME}`)
    .orderBy('DATE', 'desc')
    .limit(1)
    .first()
    .select('*');

  const changePerDay = Number((BigInt(current.SIZE) - BigInt(lastWeek.SIZE)) * BigInt(100)) / 700;

  return changePerDay;
}

/**
 * @param {import('knex')} connections
 */
export default async function getDaysTillFullMetrics(connections) {
  return Promise.all(connections.map(initDatabases));
}
