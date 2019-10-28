/* global BigInt */
import cfg from '@smpx/cfg';
import knex from 'knex';
import getAutoIncrementMetrics from './autoIncrement';

// eslint-disable-next-line no-extend-native
BigInt.prototype.toJSON = function () { return this.toString(); };

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

  return getAutoIncrementMetrics(connections, connectedHosts);
}
