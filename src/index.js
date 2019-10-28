import cfg from '@smpx/cfg';
import getMetrics from './db';
import putMetrics from './cloudWatch';

/**
 * @param {import('aws-lambda').APIGatewayEvent} event
 * @param {import('aws-lambda').Context} context
 */
exports.handler = async (event, context) => {
  const hosts = cfg('hosts', []).filter(Boolean);

  if (!hosts.length) {
    console.log('No hosts found, exiting.');
    return;
  }

  const metrics = await getMetrics(hosts);

  if (!metrics.length) {
    console.error('Could not get metrics from even one host, exiting.');
    return;
  }

  await putMetrics(metrics);
};

// exports.handler().then(() => {
//   console.log('success');
//   process.exit(0);
// }).catch((err) => {
//   console.error(err);
//   process.exit(1);
// });
