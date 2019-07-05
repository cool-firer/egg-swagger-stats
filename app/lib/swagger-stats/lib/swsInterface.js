/**
 * Created by sv2 on 2/16/17.
 * Modified by cool-firer on 5/29/2019
 */

'use strict';

const path = require('path');
const debug = require('debug')('sws:interface');
const promClient = require('prom-client');
const basicAuth = require('basic-auth');
const Cookies = require('cookies');
const uuidv1 = require('uuid/v1');
const crypto = require('crypto');
const fs = require('mz/fs');
const zlib = require('mz/zlib');
const mime = require('mime-types');
const compressible = require('compressible');
const AggregatorRegistry = promClient.AggregatorRegistry;

const swsUtil = require('./swsUtil');
const swsMerge = require('./swsMerge');
const swsProcessor = require('./swsProcessor');

// API data processor
let processor = null;

// swagger-stats default options
const swsOptions = {
  version: '',
  swaggerSpec: null,
  uriPath: '/swagger-stats',
  durationBuckets: [ 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000 ],
  requestSizeBuckets: [ 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000 ],
  responseSizeBuckets: [ 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000 ],
  apdexThreshold: 25,
  onResponseFinish: null,
  authentication: false,
  sessionMaxAge: 900,
  onAuthenticate: null,
};

const uiMarkup = swsUtil.swsEmbeddedUIMarkup;

let pathUI = swsOptions.uriPath + '/ui';
let pathDist = swsOptions.uriPath + '/dist';
let pathStats = swsOptions.uriPath + '/stats';
let pathMetrics = swsOptions.uriPath + '/metrics';
let pathLogout = swsOptions.uriPath + '/logout';

let requestCtr = 0; // Concurrency control
let statsRequestCtrl = 0;
let subscribed = false;
let statsSubscribed = false;
const requests = new Map(); // Pending requests for workers' local metrics.
const statsRequests = new Map();

// Session IDs storage
const sessionIDs = {};

// Store / update session id
function storeSessionID(sid) {
  const tssec = Date.now() + swsOptions.sessionMaxAge * 1000;
  sessionIDs[sid] = tssec;
  // debug('Session ID updated: %s=%d', sid,tssec);
}

// Remove Session ID
function removeSessionID(sid) {
  delete sessionIDs[sid];
}

// If authentication is enabled, executed periodically and expires old session IDs
function expireSessionIDs() {
  const tssec = Date.now();
  const expired = [];
  for (const sid in sessionIDs) {
    if (sessionIDs[sid] < (tssec + 500)) {
      expired.push(sid);
    }
  }
  for (let i = 0; i < expired.length; i++) {
    delete sessionIDs[expired[i]];
    debug('Session ID expired: %s', expired[i]);
  }
}

// Request hanlder
function handleRequest(ctx) {
  try {
    processor.processRequest(ctx);
  } catch (e) {
    debug('SWS:processRequest:ERROR: ' + e);
    console.log(e);
    return;
  }

  if (('sws' in ctx) && ('track' in ctx.sws) && !ctx.sws.track) {
    // Tracking disabled for this request
    return;
  }

  // Setup handler for finishing reponse
  // ctx.res.on('finish', function() {
  //   handleResponseFinished(this);
  // });
  ctx.res.on('finish', function() {
    handleResponseFinished(ctx);
  });
}

// Response finish hanlder
function handleResponseFinished(ctx) {
  try {
    processor.processResponse(ctx);
  } catch (e) {
    console.log(e);
    debug('SWS:processResponse:ERROR: ' + e);
  }
}

// Override defaults if options are provided
function processOptions(options) {
  if (!options) return;

  for (const op in swsUtil.supportedOptions) {
    if (op in options) {
      swsOptions[op] = options[op];
    }
  }

  // update standard path
  pathUI = swsOptions.uriPath + '/ui';
  pathDist = swsOptions.uriPath + '/dist';
  pathStats = swsOptions.uriPath + '/stats';
  pathMetrics = swsOptions.uriPath + '/metrics';
  pathLogout = swsOptions.uriPath + '/logout';

  if (swsOptions.authentication) {
    setInterval(expireSessionIDs, 500);
  }
}


function processAuth(req, res, useWWWAuth) {

  return new Promise(function(resolve, reject) {
    if (!swsOptions.authentication) {
      return resolve(true);
    }

    const cookies = new Cookies(req, res);

    // Check session cookie
    const sessionIdCookie = cookies.get('sws-session-id');
    if ((sessionIdCookie !== undefined) && (sessionIdCookie !== null)) {

      if (sessionIdCookie in sessionIDs) {
        // renew it
        // sessionIDs[sessionIdCookie] = Date.now();
        storeSessionID(sessionIdCookie);
        cookies.set('sws-session-id', sessionIdCookie, { path: swsOptions.uriPath, maxAge: swsOptions.sessionMaxAge * 1000 });
        // Ok
        req['sws-auth'] = true;
        return resolve(true);
      }
    }

    const authInfo = basicAuth(req);

    let authenticated = false;
    let msg = 'Authentication required';

    if ((authInfo !== undefined) && (authInfo !== null) && ('name' in authInfo) && ('pass' in authInfo)) {
      if (typeof swsOptions.onAuthenticate === 'function') {

        Promise.resolve(swsOptions.onAuthenticate(req, authInfo.name, authInfo.pass)).then(function(onAuthResult) {
          if (onAuthResult) {

            authenticated = true;

            // Session is only for stats requests
            if (req.url.startsWith(pathStats)) {
              // Generate session id
              const sessid = uuidv1();
              storeSessionID(sessid);
              // Set session cookie with expiration in 15 min
              cookies.set('sws-session-id', sessid, { path: swsOptions.uriPath, maxAge: swsOptions.sessionMaxAge * 1000 });
            }

            req['sws-auth'] = true;
            return resolve(true);

          }
          msg = 'Invalid credentials';
          res.status(403).end(msg);
          return resolve(false);

        });

      } else {
        res.status(403).end(msg);
        return resolve(false);
      }
    } else {
      res.status(403).end(msg);
      return resolve(false);
    }

  });
}

function processLogout(req, res) {

  const cookies = new Cookies(req, res);

  // Check session cookie
  const sessionIdCookie = cookies.get('sws-session-id');
  if ((sessionIdCookie !== undefined) && (sessionIdCookie !== null)) {
    if (sessionIdCookie in sessionIDs) {
      removeSessionID(sessionIdCookie);
      cookies.set('sws-session-id'); // deletes cookie
    }
  }

  res.status(200).end('Logged out');
}


// Process /swagger-stats/stats request
// Return statistics according to request parameters
// Query parameters (fields, path, method) defines which stat fields to return
async function processGetStats(ctx, app) {

  const { req, res } = ctx;

  ctx.status = 200;
  if (('sws-auth' in req) && req['sws-auth']) {
    ctx.set('x-sws-authenticated', 'true');
  }

  const result = await new Promise((resolve, reject) => {
    function done(err, result) {
      if (err) {
        console.log(err);

        const that = this;
        // timeout, remove dead worker
        app.metricsClient.publish({
          dataId: 'revise-workers',
          message: {
            workers: that.aliveWorkers,
          },
        });

        const res = this.responses.reduce(function(prev, cur, index, arr) {
          if (index == 0) return cur;
          return that.queryHandler(prev, cur, arr.length);
        }, {});
        resolve(res);
      } else {
        resolve(result);
      }
    }

    let queryHandler = swsMerge.mergeStats;
    if (ctx.query['fields[]'] === 'timeline') {
      queryHandler = swsMerge.mergeTimeLine;
    } else if (ctx.query['fields[]'] === 'longestreq') {
      queryHandler = swsMerge.mergeLongestReq;
    } else if (ctx.query['fields[]'] === 'lasterrors') {
      queryHandler = swsMerge.mregeLastErrors;
    } else if (ctx.query['fields[]'] === 'errors') {
      queryHandler = swsMerge.mergeErrors;
    } else if (ctx.query['fields[]'] === 'method') {
      queryHandler = swsMerge.mergeMethod;
    } else if (ctx.query['fields[]'] === 'apiop') {
      queryHandler = swsMerge.mergeApiOp;
    }

    const requestId = statsRequestCtrl++;
    const request = {
      responses: [],
      pending: app.avaibleWorkers.size,
      done,
      query: ctx.request.query,
      queryHandler,
      errorTimeout: setTimeout(() => {
        request.failed = true;
        const err = new Error('swagger-status stats Operation timed out.');
        request.done(err);
      }, 5000),
      failed: false,
      aliveWorkers: [],
    };
    statsRequests.set(requestId, request);

    if (statsRequests.pending === 0) {
      // No workers were up
      statsRequests.delete(message.requestId);
      clearTimeout(statsRequests.errorTimeout);
      // process.nextTick(() => done(null, ''));
      return done(null, {});
    }

    app.metricsClient.publish({
      dataId: 'gime_stats',
      message: {
        target: process.pid,
        query: ctx.request.query,
        requestId,
      },
    });

    if (!statsSubscribed) {
      app.metricsClient.subscribe('gime_stats_res_' + process.pid, message => {

        // console.log("GOt stats response:");
        const _request = statsRequests.get(message.requestId);

        _request.responses.push(message.stats);
        _request.pending--;
        _request.aliveWorkers.push(message.pid);
        if (_request.pending === 0) {
          // finalize
          requests.delete(message.requestId);
          clearTimeout(_request.errorTimeout);

          if (_request.failed) return; // Callback already run with Error.

          const result = _request.responses.reduce(function(prev, cur, index, arr) {
            if (index == 0) return cur;
            return _request.queryHandler(prev, cur, arr.length);
          }, {});
          _request.done(null, result);
        }
      });
      statsSubscribed = true;
    }
  });
  ctx.body = result;

  // ctx.body = processor.getStats(ctx.request.query);
  // res.json(processor.getStats(req.query));
  // });

}


// Process /swagger-stats/metrics request
// Return all metrics for Prometheus
async function processGetMetrics(ctx, app) {

  // ctx.body = promClient.register.metrics();

  const metrics = await new Promise((resolve, reject) => {

    const requestId = requestCtr++;
    function done(err, result) {

      if (err) {
        console.log(err);
        const that = this;
        // timeout, remove dead worker
        app.metricsClient.publish({
          dataId: 'revise-workers',
          message: {
            workers: that.aliveWorkers,
          },
        });
        const registry = AggregatorRegistry.aggregate(this.responses);
        const promString = registry.metrics();
        resolve(promString);
      } else {
        resolve(result);
      }
    }

    const request = {
      responses: [],
      pending: app.avaibleWorkers.size,
      done,
      errorTimeout: setTimeout(() => {
        request.failed = true;
        const err = new Error('swagger-status Operation timed out.');
        request.done(err);
      }, 5000),
      failed: false,
      aliveWorkers: [],
    };
    requests.set(requestId, request);

    if (request.pending === 0) {
      // No workers were up
      requests.delete(requestId);
      clearTimeout(request.errorTimeout);
      // process.nextTick(() => done(null, ''));
      return done(null, '');
    }


    app.metricsClient.publish({
      dataId: 'gime_metrics',
      message: {
        target: process.pid,
        requestId,
      },
    });
    if (!subscribed) {
      app.metricsClient.subscribe('gime_metrics_back_' + process.pid, message => {

        const _request = requests.get(message.requestId);
        message.metrics.forEach(registry => _request.responses.push(registry));
        _request.pending--;
        _request.aliveWorkers.push(message.pid);
        if (_request.pending === 0) {
          // finalize
          requests.delete(message.requestId);
          clearTimeout(_request.errorTimeout);

          if (_request.failed) return; // Callback already run with Error.

          const registry = AggregatorRegistry.aggregate(_request.responses);
          const promString = registry.metrics();

          _request.done(null, promString);
        }
      });

      subscribed = true;
    }
  });
  ctx.body = metrics;
  // const { req, res } = ctx;
  // processAuth(req, res).then(function(authResult) {
  //   if (!authResult) {
  //     return;
  //   }
  //   ctx.body = promClient.register.metrics();
  // });


}


function FileManager(store) {
  if (store && typeof store.set === 'function' && typeof store.get === 'function') {
    this.store = store;
  } else {
    this.map = store || Object.create(null);
  }
}

FileManager.prototype.get = function(key) {
  return this.store ? this.store.get(key) : this.map[key];
};

FileManager.prototype.set = function(key, value) {
  if (this.store) return this.store.set(key, value);
  this.map[key] = value;
};


function loadFile(name, fullpath, options, files) {

  if (!files.get(fullpath)) files.set(fullpath, {});
  const obj = files.get(fullpath);

  const stats = fs.statSync(fullpath);
  let buffer = fs.readFileSync(fullpath);

  obj.fileName = name;
  obj.path = fullpath;
  obj.cacheControl = options.cacheControl;
  obj.maxAge = obj.maxAge ? obj.maxAge : options.maxAge || 0;
  obj.type = obj.mime = mime.lookup(fullpath) || 'application/octet-stream';
  obj.mtime = stats.mtime;
  obj.length = stats.size;
  obj.md5 = crypto.createHash('md5').update(buffer).digest('base64');

  debug('file: ' + JSON.stringify(obj, null, 2));

  buffer = null;
  return obj;
}


module.exports = {

  // Initialize swagger-stats and return
  // middleware to perform API Data collection
  getMiddleware(options, app) {

    processOptions(options);

    processor = new swsProcessor();
    processor.init(swsOptions);

    app.metricsClient.subscribe('gime_stats', message => {
      app.metricsClient.publish({
        dataId: 'gime_stats_res_' + message.target,
        message: {
          stats: processor.getStats(message.query),
          pid: process.pid,
          requestId: message.requestId,
        },
      });
    });

    const files = new FileManager(options.files);

    return async function trackingMiddleware(ctx, next) {

      const { req, res } = ctx;

      // Respond to requests handled by swagger-stats
      // swagger-stats requests will not be counted in statistics
      if (req.url.startsWith(pathStats)) {
        return await processGetStats(ctx, app);
      } else if (req.url.startsWith(pathMetrics)) {
        return await processGetMetrics(ctx, app);
      } else if (req.url.startsWith(pathLogout)) {
        processLogout(req, res);
        return;
      } else if (req.url.startsWith(pathUI)) {
        res.statusCode = 200;

        res.end(uiMarkup);
        return;
      } else if (req.url.startsWith(pathDist)) {
        let fileName = req.url.replace(pathDist + '/', '');
        const qidx = fileName.indexOf('?');
        if (qidx != -1) fileName = fileName.substring(0, qidx);

        const fullpath = path.join(__dirname, '..', 'dist', fileName);

        let file = files.get(fullpath);

        // try to load file
        if (!file) {
          let s;
          try {
            s = await fs.stat(fullpath);
          } catch (err) {
            return await next();
          }
          if (!s.isFile()) return await next();
          file = loadFile(fileName, fullpath, options, files);
        }

        ctx.status = 200;

        ctx.vary('Accept-Encoding');

        if (!file.buffer) {
          const stats = await fs.stat(file.path);
          if (stats.mtime > file.mtime) {
            file.mtime = stats.mtime;
            file.md5 = null;
            file.length = stats.size;
          }
        }
        ctx.response.lastModified = file.mtime;
        if (file.md5) ctx.response.etag = file.md5;
        if (ctx.fresh) return ctx.status = 304;

        ctx.type = file.type;
        ctx.length = file.zipBuffer ? file.zipBuffer.length : file.length;
        ctx.set('cache-control', file.cacheControl || 'public, max-age=' + file.maxAge);
        if (file.md5) ctx.set('content-md5', file.md5);

        const acceptGzip = ctx.acceptsEncodings('gzip') === 'gzip';

        const shouldGzip = file.length > 1024 && acceptGzip && compressible(file.type);

        const stream = fs.createReadStream(file.path);

        // update file hash
        if (!file.md5) {
          const hash = crypto.createHash('md5');
          stream.on('data', hash.update.bind(hash));
          stream.on('end', function() {
            file.md5 = hash.digest('base64');
          });
        }

        ctx.body = stream;

        if (shouldGzip) {
          ctx.remove('content-length');
          ctx.set('content-encoding', 'gzip');
          ctx.body = stream.pipe(zlib.createGzip());
        }
        // var options = {
        // 	root: path.join(__dirname, '..', 'dist'),
        // 	dotfiles: 'deny'
        // 	// TODO Caching
        // };

        // res.sendFile(fileName, options, function (err) {
        // 	if (err) {
        // 		debug('unable to send file: %s', fileName);
        // 	}
        // });
      }

      handleRequest(ctx);

      return next();
    };
  },

  // TODO Support specifying which stat fields to return
  // Returns object with collected statistics
  getCoreStats() {
    return processor.getStats();
  },

  // Allow get stats as prometheus format
  getPromStats() {
    return promClient.register.metrics();
  },

  // Expose promClient to allow for custom metrics by application
  getPromClient() {
    return promClient;
  },
};
