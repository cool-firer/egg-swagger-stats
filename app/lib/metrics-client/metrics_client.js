'use strict';

const Base = require('sdk-base');

class RegistryMetricsClient extends Base {
  constructor(options) {
    super({
      // 指定异步启动的方法
      initMethod: 'init',
    });
    this._options = options;
    this._registered = new Map();
  }

  /**
   * 启动逻辑
   */
  async init() {
    this.ready(true);
  }

  /**
   * 获取配置
   * @param {String} dataId - the dataId
   * @return {Object} 配置
   */
  async getConfig(dataId) {
    return this._registered.get(dataId);
  }

  /**
   * 订阅
   * @param {Object} reg
   *   - {String} dataId - the dataId
   * @param {Function}  listener - the listener
   */
  subscribe(key, listener) {
    this.on(key, listener);
  }

  /**
   * 发布
   *   - {String} dataId - the dataId
   *   - {String} publishData - the publish data
   */
  publish(reg) {
    const key = reg.dataId;
    this.emit(key, reg.message);
  }
}

module.exports = RegistryMetricsClient;
