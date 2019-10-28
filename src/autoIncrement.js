/* eslint-disable import/prefer-default-export */
/* global BigInt */

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
      return BigInt('4294967295');
    }
    return BigInt('2147483647');
  }
  if (dataType === 'BIGINT') {
    if (columnType.includes('unsigned')) {
      return (BigInt(2) ** BigInt(64)) - BigInt(1);
    }
    return (BigInt(2) ** BigInt(63)) - BigInt(1);
  }
  console.error(`Invalid data type: ${dataType} (${columnType})`);
  return BigInt('2147483647');
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
export async function getColumnsWithAutoIncrementValues(connection) {
  if (!connection) return [];

  /** @type {ColumnDetails[]} */
  const columns = await connection.queryBuilder()
    .table('INFORMATION_SCHEMA.TABLES')
    .join('INFORMATION_SCHEMA.COLUMNS', (q) => {
      q.on('TABLES.TABLE_SCHEMA', 'COLUMNS.TABLE_SCHEMA')
        .andOn('TABLES.TABLE_NAME', 'COLUMNS.TABLE_NAME');
    })
    .whereRaw('?? LIKE ?', ['COLUMNS.EXTRA', '%auto_increment%'])
    .whereNotNull('TABLES.AUTO_INCREMENT')
    .select(
      'TABLES.AUTO_INCREMENT', 'TABLES.TABLE_NAME', 'TABLES.TABLE_SCHEMA', 'TABLES.TABLE_ROWS',
      'COLUMNS.COLUMN_NAME', 'COLUMNS.DATA_TYPE', 'COLUMNS.COLUMN_TYPE',
    );

  return columns.map((c) => ({
    ...c,
    AUTO_INCREMENT: BigInt(c.AUTO_INCREMENT),
    MAX_VAL: getMaxValue(c),
  }));
}

export default async function getAutoIncrementMetrics(connections, connectedHosts) {
  const columnsPerHost = await Promise.all(connections
    .map(getColumnsWithAutoIncrementValues));

  const metricsPerHost = connectedHosts.map((host) => ({
    host,
    /** @type {ColumnDetailsExt[]} */
    metrics: [],
  }));

  columnsPerHost.forEach((columns, index) => {
    columns.forEach((columnDetails) => {
      metricsPerHost[index].metrics.push({
        ...columnDetails,
        PERCENTAGE: Number((columnDetails.AUTO_INCREMENT * BigInt(10000))
          / columnDetails.MAX_VAL) / 100,
      });
    });

    metricsPerHost[index].metrics.sort((a, b) => b.PERCENTAGE - a.PERCENTAGE);
  });
  return metricsPerHost;
}
