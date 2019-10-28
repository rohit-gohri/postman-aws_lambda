import cfg from '@smpx/cfg';
import CloudWatch from 'aws-sdk/clients/cloudwatch';

const METRIC_NAME = 'AutoIncrementCapacity';

/**
 *
 * @param {import('./db').ColumnDetailsExt[]} metrics
 */
export default async function putMetrics(metrics) {
  const cloudWatch = cfg('cloudWatch') ? new CloudWatch(cfg('cloudWatch')) : new CloudWatch();

  return cloudWatch.putMetricData({
    MetricData: [
      {
        MetricName: METRIC_NAME,
        Dimensions: [{
          Name: 'Database',
          Value: metrics[0].TABLE_SCHEMA,
        }, {
          Name: 'Table',
          Value: metrics[0].TABLE_NAME,
        }],
        Unit: 'Percent',
        Timestamp: new Date(),
        Value: metrics[0].PERCENTAGE || 0,
      },
    ],
    Namespace: 'RDS',
  }).promise();
}
