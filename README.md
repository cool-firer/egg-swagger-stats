# egg-swagger-stats

swagger-stats plugin for egg, support cluster.


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
open browser, navigate to the url below:
metrics: /host:port/swagger-stats/metrics
     ui: /host:port/swagger-stats/ui

recommand using prometheus to collect metrics.
```


## License

[MIT](LICENSE)

