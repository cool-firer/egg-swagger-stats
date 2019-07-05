# egg-swagger-stats

swagger-stats egg插件, 支持cluster模式获取所有metrics.


## Install

```bash
$ npm i egg-egg-swagger-stats --save
```

## Usage

```js
// {app_root}/config/plugin.js
exports.eggSwaggerStats = {
  enable: true,
  package: 'egg-egg-swagger-stats',
};
```

## Configuration

```js
// {app_root}/config/config.default.js
exports.eggSwaggerStats = {
};
```

see [swaggerstats.io](http://swaggerstats.io/docs.html) for more detail.

## Example

```js
打开浏览器访问以下地址:
metrics: /host:port/swagger-stats/metrics
     ui: /host:port/swagger-stats/ui

推荐使用prometheus采集metrics.
```


## License

[MIT](LICENSE)

