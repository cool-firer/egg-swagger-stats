'use strict';

const cluster = require('cluster-client');
const Base = require('sdk-base');
const RegistryMetricsClient = require('./metrics_client');

class MetricsClient extends Base {
  constructor(options) {
    super(options);

    // options.cluster 用于给 Egg 的插件传递 app.cluster 进来
    this._client = (options.cluster || cluster)(RegistryMetricsClient).create(options);
    this._client.ready(() => this.ready(true));

  }

  subscribe(reg, listener) {
    this._client.subscribe(reg, listener);
  }

  publish(reg) {
    this._client.publish(reg);
  }

  get(key) {
    return this._cache[key];
  }
}

// 最终模块向外暴露这个 APIClient
module.exports = MetricsClient;