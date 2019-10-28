/* global BigInt */
import cfg from '@smpx/cfg';
import knex from 'knex';

BigInt.prototype.toJSON = function() { return this.toString(); }

const BLACKLIST_DBS = [
  'information_schema',
  'innodb',
  'mysql',
  'performance_schema',
  'sys',
];

async function getDBs(connection) {
  const [rows] = await connection.raw('SHOW DATABASES');
  return rows.map((r) => r.Database).filter((db) => !BLACKLIST_DBS.includes(db));
}

/**
   * @typedef {{
   *  TABLE_SCHEMA: string;
   *  TABLE_NAME: string;
   *  COLUMN_NAME: string;
   *  DATA_TYPE: string;
   *  COLUMN_TYPE: string;
   *  AUTO_INCREMENT: bigint;
   *  TABLE_ROWS: number;
   * }} ColumnDetails
   */

/**
 *
 * @param {ColumnDetails} column
 */
function getMaxValue(column) {
  const dataType = column.DATA_TYPE.toUpperCase();
  const columnType = column.COLUMN_TYPE.toLowerCase();
  if (dataType === 'TINYINT') {
    if (columnType.includes('unsigned')) {
      return BigInt(255);
    }
    return BigInt(127);
  }
  if (dataType === 'SMALLINT') {
    if (columnType.includes('unsigned')) {
      return BigInt(65535);
    }
    return BigInt(32767);
  }
  if (dataType === 'MEDIUMINT') {
    if (columnType.includes('unsigned')) {
      return BigInt(16777215);
    }
    return BigInt(8388607);
  }
  if (dataType === 'INT') {
    if (columnType.includes('unsigned')) {
      return 4294967295n;
    }
    return 2147483647n;
  }
  if (dataType === 'BIGINT') {
    if (columnType.includes('unsigned')) {
      return (2n ** 64n) - 1n;
    }
    return (2n ** 63n) - 1n;
  }
  console.error(`Invalid data type: ${dataType} (${columnType})`);
  return 2147483647n;
}

/**
   * @typedef {ColumnDetails & {
   *  MAX_VAL: bigint;
   *  PERCENTAGE?: number;
   * }} ColumnDetailsExt
   */


/**
   * @param {knex | null} connection
   */
async function getColumnsWithAutoIncrementValues(connection) {
  if (!connection) return [];

  /** @type {ColumnDetails[]} */
  const columns = await connection.queryBuilder()
    .table('INFORMATION_SCHEMA.TABLES')
    .join('INFORMATION_SCHEMA.COLUMNS', (q) => {
      q.on('TABLES.TABLE_SCHEMA', 'COLUMNS.TABLE_SCHEMA')
      .andOn('TABLES.TABLE_NAME', 'COLUMNS.TABLE_NAME')
    })
    .whereRaw('?? LIKE ?', ['COLUMNS.EXTRA', '%auto_increment%'])
    .whereNotNull('TABLES.AUTO_INCREMENT')
    .select(
      'TABLES.AUTO_INCREMENT', 'TABLES.TABLE_NAME', 'TABLES.TABLE_SCHEMA', 'TABLES.TABLE_ROWS',
      'COLUMNS.COLUMN_NAME', 'COLUMNS.DATA_TYPE', 'COLUMNS.COLUMN_TYPE',
    );

  return columns.map(c => {
    return {
      ...c,
      AUTO_INCREMENT: BigInt(c.AUTO_INCREMENT),
      MAX_VAL: getMaxValue(c),
    };
  });
}

/**
 * @param {string[]} hosts
 */
export default async function getMetrics(hosts) {
  let connections = await Promise.all(hosts.map(async (host) => {
    const connectionSetting = { ...cfg('db'), host };
    try {
      const connection = knex({
        connection: connectionSetting,
        client: 'mysql',
      });
      await connection.raw('select 1 as dbIsUp');
      return connection;
    } catch (err) {
      console.error(`Could not connect to host: ${host}`, err);
      return null;
    }
  }));

  const successConnections = connections.map((connection, index) => ({
    connection,
    host: hosts[index],
  })).filter((details) => Boolean(details.connection));

  if (successConnections.length < hosts.length) {
    console.error(`Failed to connect to ${hosts.length - successConnections.length} hosts.`);
    if (!successConnections.length) {
      console.error('Could not connect to even one host.');
      return [];
    }
  }
  console.log(`Connected to ${successConnections.length} host(s)!`);

  connections = successConnections.map((details) => details.connection);
  const connectedHosts = successConnections.map((details) => details.host);

  const columnsPerHost = await Promise.all(connections
    .map(getColumnsWithAutoIncrementValues));

  const metricsPerHost = connectedHosts.map((host) => ({
    host,
    /** @type {ColumnDetailsExt[]} */
    metrics: [],
  }));

  columnsPerHost.forEach((columns, index) => {
    columns.forEach((columnDetails) => {
      columnDetails.PERCENTAGE = Number(columnDetails.AUTO_INCREMENT * 10000n / columnDetails.MAX_VAL) / 100;

      metricsPerHost[index].metrics.push(columnDetails);
    });
 
    metricsPerHost[index].metrics.sort((a, b) => b.PERCENTAGE - a.PERCENTAGE);
  });

  return metricsPerHost;
}
