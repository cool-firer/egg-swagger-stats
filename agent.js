// agent.js
const MetricsClient = require('./metrics-client');

module.exports = agent => {

  const config = agent.config.metricsClient;
  agent.metricsClient = new MetricsClient(Object.assign({}, config, { cluster: agent.cluster }));
  agent.beforeStart(async () => {
    await agent.metricsClient.ready();
  });
};