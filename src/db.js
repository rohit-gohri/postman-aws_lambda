import cfg from '@smpx/cfg';
import knex from 'knex';

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
  if (column.DATA_TYPE === 'int') {
    if (column.COLUMN_TYPE.includes('unsigned')) {
      return 1000;
    }
    return 1000;
  }
  return 1000;
}

/**
   * @typedef {ColumnDetails & {
   *  MAX_VAL: number;
   *  PERCENTAGE?: number;
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
   *  AUTO_INCREMENT: number;
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
    tableMap[table.TABLE_SCHEMA][table.TABLE_NAME] = table;
  });

  return tableMap;
}

/**
 * @param {string[]} hosts
 */
export default async function getMetrics(hosts) {
  let connections = hosts.map((host) => {
    const connectionSetting = { ...cfg('db'), host };
    try {
      const connection = knex({
        connection: connectionSetting,
        client: 'mysql',
      });
      return connection;
    } catch (err) {
      console.error(`Could not connect to host: ${host}`, err);
      return null;
    }
  });

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

        columnDetails.PERCENTAGE = (tableDetails.AUTO_INCREMENT / columnDetails.MAX_VAL) * 100;

        metricsPerHost[index].metrics.push(columnDetails);
      });
    });

    metricsPerHost[index].metrics.sort((a, b) => b.PERCENTAGE - a.PERCENTAGE);
  });

  return metricsPerHost;
}
