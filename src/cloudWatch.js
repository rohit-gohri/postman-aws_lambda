import { flatten } from 'lodash';
import cfg from '@smpx/cfg';
import CloudWatch from 'aws-sdk/clients/cloudwatch';

const AUTO_INCRMENT = 'AutoIncrementCapacity';
const RATE_DISK_FULL = 'ChangeInDiskPerDay';

/**
 * @template T
 * @typedef {T extends Promise<infer R> ? R : T} ResolveType
 */

/**
 * @param {ResolveType<ReturnType<import('./db').default>>} metricsPerHost
 */
export default async function putMetrics(metricsPerHost) {
  const cloudWatch = cfg('cloudWatch') ? new CloudWatch(cfg('cloudWatch')) : new CloudWatch();

  const metricData = metricsPerHost.map(({ host, metrics, change }) => {
    if (!metrics.length || Number.isNaN(Number(metrics[0].PERCENTAGE))) {
      console.error(`Invalid metric for host: ${host}`);
      return null;
    }

    /** @type {import('aws-sdk/clients/cloudwatch').MetricData} */
    const metricDataItem = [{
      MetricName: AUTO_INCRMENT,
      Dimensions: [{
        Name: 'DBInstanceIdentifier',
        Value: host.split('.')[0],
      }],
      Unit: 'Percent',
      Timestamp: new Date(),
      Value: metrics[0].PERCENTAGE || 0,
    }, {
      MetricName: RATE_DISK_FULL,
      Dimensions: [{
        Name: 'DBInstanceIdentifier',
        Value: host.split('.')[0],
      }],
      Unit: 'Percent',
      Timestamp: new Date(),
      Value: change,
    }];
    return metricDataItem;
  }).filter(Boolean);

  if (!metricData.length) {
    console.error('No valid metrics found.');
    return;
  }

  try {
    await cloudWatch.putMetricData({
      Namespace: 'RDS',
      MetricData: flatten(metricData),
    }).promise();
    console.log(`Successfully added ${metricData.length} metric(s)`);
  } catch (err) {
    console.error('Failed to add metrics', err);
  }
}
