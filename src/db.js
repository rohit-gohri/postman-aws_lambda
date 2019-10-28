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
   *  AUTO_INCREMENT?: bigint
   * }} ColumnDetailsExt
   */

/**
   * @param {knex | null} connection
   */
async function getTableMapForAutoIncrementColumns(connection) {
  if (!connection) return {};

  /** @type {ColumnDetails[]} */
  const columns = await connection.queryBuilder()
    .table('INFORMATION_SCHEMA.COLUMNS')
    .whereRaw('?? LIKE ?', ['EXTRA', '%auto_increment%'])
    .select('TABLE_SCHEMA', 'TABLE_NAME', 'COLUMN_NAME', 'DATA_TYPE', 'COLUMN_TYPE');

  /**
     * @type {{
     *  [db: string]: {
     *      [table: string]: ColumnDetailsEx
     * }}}
     */
  const tableMap = {};

  columns.forEach((column) => {
    tableMap[column.TABLE_SCHEMA] = tableMap[column.TABLE_SCHEMA] || {};
    tableMap[column.TABLE_SCHEMA][column.TABLE_NAME] = {
      ...column,
      MAX_VAL: getMaxValue(column),
    };
  });

  return tableMap;
}

/**
   * @typedef {{
   *  AUTO_INCREMENT: bigint;
   *  TABLE_NAME: string;
   *  TABLE_SCHEMA: string;
   *  TABLE_ROWS: number;
   * }} TableDetails
   */

/**
   * @param {knex | null} connection
   */
async function getTableMapForAutoIncrementValues(connection) {
  if (!connection) return {};

  /** @type {TableDetails[]} */
  const tables = await connection.queryBuilder()
    .table('INFORMATION_SCHEMA.TABLES')
    .whereNotNull('AUTO_INCREMENT')
    .select('AUTO_INCREMENT', 'TABLE_NAME', 'TABLE_SCHEMA', 'TABLE_ROWS');

  /**
     * @type {{
     *  [db: string]: {
     *      [table: string]: TableDetails
     * }}}
     */
  const tableMap = {};

  tables.forEach((table) => {
    tableMap[table.TABLE_SCHEMA] = tableMap[table.TABLE_SCHEMA] || {};
    tableMap[table.TABLE_SCHEMA][table.TABLE_NAME] = {
      ...table,
      AUTO_INCREMENT: BigInt(table.AUTO_INCREMENT),
    };
  });

  return tableMap;
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

  const columnMaps = await Promise.all(connections
    .map(getTableMapForAutoIncrementColumns));

  const tableMaps = await Promise.all(connections
    .map(getTableMapForAutoIncrementValues));

  const metricsPerHost = connectedHosts.map((host) => ({
    host,
    /** @type {ColumnDetailsExt[]} */
    metrics: [],
  }));

  //  TODO: Use join query instead
  tableMaps.forEach((tableMap, index) => {
    const columnMap = columnMaps[index];

    Object.keys(tableMap).forEach((db) => {
      const tableDetailMap = tableMap[db];
      Object.keys(tableDetailMap).forEach((table) => {
        /** @type {ColumnDetailsExt} */
        const columnDetails = columnMap[db] && columnMap[db][table];
        /** @type {TableDetails} */
        const tableDetails = tableDetailMap[table];
        columnDetails.AUTO_INCREMENT = tableDetails.AUTO_INCREMENT;
        columnDetails.PERCENTAGE = Number(tableDetails.AUTO_INCREMENT * 10000n / columnDetails.MAX_VAL) / 100;

        metricsPerHost[index].metrics.push(columnDetails);
      });
    });

    metricsPerHost[index].metrics.sort((a, b) => b.PERCENTAGE - a.PERCENTAGE);
  });

  return metricsPerHost;
}
