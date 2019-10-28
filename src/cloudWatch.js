import cfg from '@smpx/cfg';
import CloudWatch from 'aws-sdk/clients/cloudwatch';

const METRIC_NAME = 'AutoIncrementCapacity';

/**
 * @template T
 * @typedef {T extends Promise<infer R> ? R : T} ResolveType
 */

/**
 * @param {ResolveType<ReturnType<import('./db').default>>} metricsPerHost
 */
export default async function putMetrics(metricsPerHost) {
  const cloudWatch = cfg('cloudWatch') ? new CloudWatch(cfg('cloudWatch')) : new CloudWatch();

  const metricData = metricsPerHost.map(({ host, metrics }) => {
    /** @type {import('aws-sdk/clients/cloudwatch').MetricDatum} */
    const metricDataItem = {
      MetricName: METRIC_NAME,
      Dimensions: [{
        Name: 'DBInstanceIdentifier',
        Value: host.split('.')[0],
      }],
      Unit: 'Percent',
      Timestamp: new Date(),
      Value: metrics[0].PERCENTAGE || 0,
    };
    return metricDataItem;
  });

  return cloudWatch.putMetricData({
    Namespace: 'RDS',
    MetricData: metricData,
  }).promise();
}
