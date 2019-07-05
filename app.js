const promClient = require("prom-client");
const registries = [promClient.Registry.globalRegistry];

const MetricsClient = require('./app/lib/metrics-client');


module.exports = app => {

  // const index = app.config.coreMiddleware.indexOf('bodyParser');
  // assert(index >= 0, 'bodyParser 中间件必须存在');
  app.config.coreMiddleware.push('eggSwaggerStats');
  const config = app.config.metricsClient;
  app.metricsClient = new MetricsClient(Object.assign({}, config, { cluster: app.cluster }));
  app.beforeStart(async () => {
    await app.metricsClient.ready();

    app.avaibleWorkers = new Set();

    // send oneline signal to other worker
    app.metricsClient.subscribe('$metrics$worker_on', worker => {
      app.avaibleWorkers.add(worker.pid);
    });

    // subscribe other worker online signal
    app.metricsClient.publish({
      dataId: '$metrics$worker_on',
      message: {
        pid: process.pid
      }
    });

    app.metricsClient.subscribe('revise-workers', message => {
      if (message.workers.length > 0) {
        app.avaibleWorkers = new Set(message.workers);
      }
    });

    app.metricsClient.subscribe('gime_metrics', message => {
      app.metricsClient.publish({
        dataId: 'gime_metrics_back_' + message.target,
        message: {
          requestId: message.requestId,
          pid: process.pid,
          metrics: registries.map(r => r.getMetricsAsJSON())
        }
      });
    })
  });
};
