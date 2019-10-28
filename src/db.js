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
   * @param {knex} connection
   */
async function getTableMapForAutoIncrementColumns(connection) {
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
   * @param {knex} connection
   */
async function getTableMapForAutoIncrementValues(connection) {
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
  const connections = hosts.map((host) => {
    const connection = { ...cfg('db'), host };
    return knex({
      connection,
      client: 'mysql',
    });
  });

  console.log(`Connected to ${connections.length} host(s)!`);

  const columnMaps = await Promise.all(connections
    .map(getTableMapForAutoIncrementColumns));

  const tableMaps = await Promise.all(connections
    .map(getTableMapForAutoIncrementValues));

  /** @type {ColumnDetailsExt[]} */
  const metrics = [];

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

        metrics.push(columnDetails);
      });
    });
  });

  metrics.sort((a, b) => b.PERCENTAGE - a.PERCENTAGE);

  return metrics;
}
