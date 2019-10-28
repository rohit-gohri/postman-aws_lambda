import cfg from '@smpx/cfg';
import getMetrics from './db';
import putMetrics from './cloudWatch';

/**
 * @param {import('aws-lambda').APIGatewayEvent} event
 * @param {import('aws-lambda').Context} context
 */
exports.handler = async (event, context) => {
  const hosts = cfg('hosts', []);
  const metrics = await getMetrics(hosts);
  console.log(JSON.stringify(metrics, null, 4));
  await putMetrics(metrics);
};

exports.handler().then(() => {
  console.log('success');
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
