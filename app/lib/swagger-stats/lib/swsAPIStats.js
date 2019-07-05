/**
 * Created by sv2 on 2/18/17.
 * API Statistics
 */

'use strict';

var util = require('util');
var pathToRegexp = require('path-to-regexp');
var debug = require('debug')('sws:apistats');
var promClient = require("prom-client");


var swsUtil = require('./swsUtil');
var swsReqResStats = require('./swsReqResStats');
var swsBucketStats = require('./swsBucketStats');


// API Statistics
// Stores Definition of API based on Swagger Spec
// Stores API Statistics, for both Swagger spec-based API, as well as for detected Express APIs (route.path)
// Stores Detailed Stats for each API request
function swsAPIStats() {

    // Options
    this.options = null;

    // API Base path per swagger spec
    this.basePath = '/';

    // Array of possible API path matches, populated based on Swagger spec
    // Contains regex to match URI to Swagger path
    this.apiMatchIndex = {};

    // API definition - entry per API request from swagger spec
    // Stores attributes of known Swagger APIs - description, summary, tags, parameters
    this.apidefs = {};

    // API statistics - entry per API request from swagger
    // Paths not covered by swagger will be added on demand as used
    this.apistats = {};

    // Detailed API stats
    // TODO Consider: individual timelines (?), parameters (query/path?)
    this.apidetails = {};

    // Buckets for histograms, with default bucket values
    this.durationBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    this.requestSizeBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    this.responseSizeBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

    // Prometheus metrics in prom-client
    this.promClientMetrics = {};

    this.promClientMetrics.api_request_total = new promClient.Counter({
        name: swsUtil.swsMetrics.api_request_total.name,
        help: swsUtil.swsMetrics.api_request_total.help,
        labelNames: ['method', 'path', 'code']
    });

    this.promClientMetrics.api_request_duration_milliseconds = new promClient.Histogram({
        name: swsUtil.swsMetrics.api_request_duration_milliseconds.name,
        help: swsUtil.swsMetrics.api_request_duration_milliseconds.help,
        labelNames: ['method', 'path', 'code'],
        buckets: this.durationBuckets
    });

    this.promClientMetrics.api_request_size_bytes = new promClient.Histogram({
        name: swsUtil.swsMetrics.api_request_size_bytes.name,
        help: swsUtil.swsMetrics.api_request_size_bytes.help,
        labelNames: ['method', 'path', 'code'],
        buckets: this.requestSizeBuckets
    });

    this.promClientMetrics.api_response_size_bytes = new promClient.Histogram({
        name: swsUtil.swsMetrics.api_response_size_bytes.name,
        help: swsUtil.swsMetrics.api_response_size_bytes.help,
        labelNames: ['method', 'path', 'code'],
        buckets: this.responseSizeBuckets
    });

    this.promClientMetrics.api_request_duration = new promClient.Gauge({
        name: swsUtil.swsMetrics.api_request_duration.name,
        help: swsUtil.swsMetrics.api_request_duration.help,
        labelNames: ['method', 'path', 'code']
    });
}

swsAPIStats.prototype.getAPIDefs = function () {
    return this.apidefs;
};

swsAPIStats.prototype.getAPIStats = function () {
    return this.apistats;
};

swsAPIStats.prototype.getAPIOperationStats = function (path, method) {

    if ((typeof path === 'undefined') || !path || (path === '')) return {};
    if ((typeof method === 'undefined') || !method || (method === '')) return {};

    var res = {};
    res[path] = {};
    res[path][method] = {};

    // api op defs
    if ((path in this.apidefs) && (method in this.apidefs[path])) {
        res[path][method].defs = this.apidefs[path][method];
    }

    // api op stats
    if ((path in this.apistats) && (method in this.apistats[path])) {
        res[path][method].stats = this.apistats[path][method];
    }

    // api op details
    if ((path in this.apidetails) && (method in this.apidetails[path])) {
        res[path][method].details = this.apidetails[path][method];
    }

    return res;
};



swsAPIStats.prototype.initBasePath = function (swaggerSpec) {
    this.basePath = swaggerSpec.basePath ? swaggerSpec.basePath : '/';
    if (this.basePath.charAt(0) !== '/') {
        this.basePath = '/' + this.basePath;
    }
    if (this.basePath.charAt(this.basePath.length - 1) !== '/') {
        this.basePath = this.basePath + '/';
    }
};

// Get full swagger Path
swsAPIStats.prototype.getFullPath = function (path) {
    var fullPath = this.basePath;
    if (path.charAt(0) === '/') {
        fullPath += path.substring(1);
    } else {
        fullPath += path;
    }
    return fullPath;
};


swsAPIStats.prototype.initialize = function (swsOptions) {

    if (typeof swsOptions === 'undefined') return;   // TODO ??? remove
    if (!swsOptions) return;

    this.options = swsOptions;

    if ('durationBuckets' in swsOptions) this.durationBuckets = swsOptions.durationBuckets;
    if ('requestSizeBuckets' in swsOptions) this.requestSizeBuckets = swsOptions.requestSizeBuckets;
    if ('responseSizeBuckets' in swsOptions) this.responseSizeBuckets = swsOptions.responseSizeBuckets;

    if (!('swaggerSpec' in swsOptions)) return;
    if (swsOptions.swaggerSpec === null) return;

    var swaggerSpec = swsOptions.swaggerSpec;

    this.initBasePath(swaggerSpec);

    if (!swaggerSpec.paths) return;

    // Enumerate all paths entries
    for (var path in swaggerSpec.paths) {

        var pathDef = swaggerSpec.paths[path];

        // Create full path
        var fullPath = this.getFullPath(path);

        // by default, regex is null
        var keys = [];
        var re = null;

        // Convert to express path
        var fullExpressPath = fullPath;

        // Create regex if we have path parameters
        if (fullExpressPath.indexOf('{') !== -1) {
            fullExpressPath = fullExpressPath.replace(/\{/g, ':');
            fullExpressPath = fullExpressPath.replace(/\}/g, '');
            re = pathToRegexp(fullExpressPath, keys);
        }

        // Add to API Match Index, leveraging express style matching
        this.apiMatchIndex[fullPath] = { re: re, keys: keys, expressPath: fullExpressPath, methods: {} };

        var operations = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'];
        for (var i = 0; i < operations.length; i++) {
            var op = operations[i];
            if (op in pathDef) {

                var opDef = pathDef[op];
                var opMethod = op.toUpperCase();

                var apiOpDef = {};   // API Operation definition
                apiOpDef.swagger = true; // by definition
                apiOpDef.deprecated = ('deprecated' in opDef) ? opDef.deprecated : false;
                if ('description' in opDef) apiOpDef.description = opDef.description;
                if ('operationId' in opDef) apiOpDef.operationId = opDef.operationId;
                if ('summary' in opDef) apiOpDef.summary = opDef.summary;
                if ('tags' in opDef) apiOpDef.tags = opDef.tags;

                // Store in match index
                this.apiMatchIndex[fullPath].methods[opMethod] = apiOpDef;

                // Store in API Operation definitions. Stored separately so only definition can be retrieved
                if (!(fullPath in this.apidefs)) this.apidefs[fullPath] = {};
                this.apidefs[fullPath][opMethod] = apiOpDef;

                // Create Stats for this API Operation; stats stored separately so only stats can be retrieved
                this.getAPIOpStats(fullPath, opMethod);

                // Create entry in apidetails
                this.getApiOpDetails(fullPath, opMethod);

                // Process parameters for this op
                this.processParameters(swaggerSpec, pathDef, opDef, fullPath, opMethod);

                debug('SWS:Initialize API:added %s %s (%s)', op, fullPath, fullExpressPath);
            }
        }
    }
};

// Process parameterss for given operation
// Take into account parameters defined as common for path (from pathDef)
swsAPIStats.prototype.processParameters = function (swaggerSpec, pathDef, opDef, fullPath, opMethod) {

    var apidetailsEntry = this.getApiOpDetails(fullPath, opMethod);

    // Params from path
    if (('parameters' in pathDef) && (pathDef.parameters instanceof Array)) {
        var pathParams = pathDef.parameters;
        for (var j = 0; j < pathParams.length; j++) {
            var param = pathParams[j];
            this.processSingleParameter(apidetailsEntry, param);
        }
    }

    // Params from Op, overriding parameters from path
    if (('parameters' in opDef) && (opDef.parameters instanceof Array)) {
        var opParams = opDef.parameters;
        for (var k = 0; k < opParams.length; k++) {
            var param = opParams[k];
            this.processSingleParameter(apidetailsEntry, param);
        }
    }

};

swsAPIStats.prototype.processSingleParameter = function (apidetailsEntry, param) {

    if (!('parameters' in apidetailsEntry)) apidetailsEntry.parameters = {};
    var params = apidetailsEntry.parameters;

    var pname = "name" in param ? param.name : null;
    if (pname === null) return;

    if (!(pname in params)) params[pname] = { name: pname };
    var paramEntry = params[pname];

    // Process all supported parameter properties
    for (var supportedProp in swsUtil.swsParameterProperties) {
        if (supportedProp in param) {
            paramEntry[supportedProp] = param[supportedProp];
        }
    }

    // Process all vendor extensions
    for (var paramProp in param) {
        if (paramProp.startsWith('x-')) {
            paramEntry[paramProp] = param[paramProp];
        }
    }

    // Add standard stats
    paramEntry.hits = 0;
    paramEntry.misses = 0;
};

// Get or create API Operation Details
swsAPIStats.prototype.getApiOpDetails = function (path, method) {
    if (!(path in this.apidetails)) this.apidetails[path] = {};
    if (!(method in this.apidetails[path])) this.apidetails[path][method] = {
        duration: new swsBucketStats(this.durationBuckets),       // Request duration histogram
        req_size: new swsBucketStats(this.requestSizeBuckets),    // Request size histogram
        res_size: new swsBucketStats(this.responseSizeBuckets),   // Response size histogram
        code: { '200': { count: 0 } }                                 // Counts by response code
    };
    return this.apidetails[path][method];
};

// Get or create API Operation Stats
swsAPIStats.prototype.getAPIOpStats = function (path, method) {
    if (!(path in this.apistats)) this.apistats[path] = {};
    if (!(method in this.apistats[path])) this.apistats[path][method] = new swsReqResStats(this.options.apdexThreshold);
    return this.apistats[path][method];
};

// Update and stats per tick
swsAPIStats.prototype.tick = function (ts, totalElapsedSec) {
    // Update Rates in apistats
    for (var path in this.apistats) {
        for (var method in this.apistats[path]) {
            this.apistats[path][method].updateRates(totalElapsedSec);
        }
    }
};

// Extract path parameter values based on successful path match results
swsAPIStats.prototype.extractPathParams = function (matchResult, keys) {
    var pathParams = {};
    for (var i = 0; i < keys.length; i++) {
        if ('name' in keys[i]) {
            var vidx = i + 1; // first element in match result is URI
            if (vidx < matchResult.length) {
                pathParams[keys[i].name] = swsUtil.swsStringValue(matchResult[vidx]);
            }
        }
    }
    return pathParams;
};

// Try to match request to API to known API definition
swsAPIStats.prototype.matchRequest = function (ctx) {

    var url = ctx.originalUrl;

    ctx.sws.match = false;  // No match by default

    // Strip query string parameters
    var qidx = url.indexOf('?');
    if (qidx != -1) {
        url = url.substring(0, qidx);
    }

    var matchEntry = null;
    var apiPath = null;
    var apiPathParams = null;
    var apiInfo = null;

    // First check if we can find exact match in apiMatchIndex
    if (url in this.apiMatchIndex) {
        matchEntry = this.apiMatchIndex[url];
        apiPath = url;
        debug('SWS:MATCH: %s exact match', url);
    } else {
        // if not, search by regex matching
        for (var swPath in this.apiMatchIndex) {
            if (this.apiMatchIndex[swPath].re !== null) {
                var matchResult = this.apiMatchIndex[swPath].re.exec(url);
                if (matchResult && (matchResult instanceof Array)) {
                    matchEntry = this.apiMatchIndex[swPath];
                    apiPath = swPath;
                    apiPathParams = this.extractPathParams(matchResult, this.apiMatchIndex[swPath].keys);
                    debug('SWS:MATCH: %s matched to %s', url, swPath);
                    break; // Done
                }
            }
        }
    }

    if (matchEntry) {

        if (ctx.method in matchEntry.methods) {

            apiInfo = matchEntry.methods[ctx.method];

            ctx.sws.match = true;       // Match is found
            ctx.sws.api_path = apiPath;
            ctx.sws.swagger = true;

            // When matched, attach only subset of information to request,
            // so we don't overload reqresinfo with repeated description, etc
            if ('deprecated' in apiInfo) ctx.sws.deprecated = apiInfo.deprecated;
            if ('operationId' in apiInfo) ctx.sws.operationId = apiInfo.operationId;
            if ('tags' in apiInfo) ctx.sws.tags = apiInfo.tags;

            // Store path parameters from match result
            if (apiPathParams) ctx.sws.path_params = apiPathParams;

        }
    }


};


// Count Api Operation Parameters Statistics
// Only count hits and misses
// Hit: parameter present
// Miss: mandatory parameter is missing
// Only supported path and query parameters
swsAPIStats.prototype.countParametersStats = function (path, method, ctx) {

    if (!('swagger' in ctx.sws) || !ctx.sws.swagger) return; // Only counting for swagger-defined API Ops
    var apiOpDetails = this.getApiOpDetails(path, method);

    if (!('parameters' in apiOpDetails)) return; // Only counting if parameters spec is there

    for (var pname in apiOpDetails.parameters) {

        var param = apiOpDetails.parameters[pname];
        var isRrequired = 'required' in param ? param.required : false;

        if ('in' in param) {
            switch (param.in) {
                case "path":
                    // Path param is always there, or request will not be matched
                    param.hits++;
                    break;
                case "query":
                    if (('query' in ctx) && (pname in ctx.query)) {
                        param.hits++;
                    } else if (isRrequired) {
                        param.misses++;
                    }
                    break;
            }
        }
    }

};


// Get Api Operation Parameter Values per specification
// Only supported path and query parameters
swsAPIStats.prototype.getApiOpParameterValues = function (path, method, ctx) {

    if (!('swagger' in ctx.sws) || !ctx.sws.swagger) return null; // Only for swagger-defined API Ops

    var apiOpDetails = this.getApiOpDetails(path, method);

    if (!('parameters' in apiOpDetails)) return null; // Only if parameters spec is there

    var paramValues = {};

    for (var pname in apiOpDetails.parameters) {

        var param = apiOpDetails.parameters[pname];

        if ('in' in param) {
            switch (param.in) {
                case "path":
                    if (('path_params' in ctx.sws) && (pname in ctx.sws.path_params)) {
                        paramValues[pname] = swsUtil.swsStringValue(ctx.sws.path_params[pname]);
                    }
                    break;

                case "query":
                    if (('query' in ctx) && (pname in ctx.query)) {
                        paramValues[pname] = swsUtil.swsStringValue(ctx.query[pname]);
                    }
                    break;
            }
        }
    }
    return paramValues;
};

// Count request
swsAPIStats.prototype.countRequest = function (ctx) {

    // Count request if it was matched to API Operation
    if (('match' in ctx.sws) && ctx.sws.match) {
        var apiOpStats = this.getAPIOpStats(ctx.sws.api_path, ctx.method);
        apiOpStats.countRequest(ctx.sws.req_clength);
        this.countParametersStats(ctx.sws.api_path, req.method, ctx);
    }

};

// Count finished response
swsAPIStats.prototype.countResponse = function (ctx) {

    var codeclass = swsUtil.getStatusCodeClass(ctx.res.statusCode);

    // Only intersted in updating stats here
    var apiOpStats = this.getAPIOpStats(ctx.sws.api_path, ctx.method);

    // If request was not matched to API operation,
    // do both count request and count response here,
    // as only at this time we know path so can map request / response to API entry
    // This allows supporting API statistics on non-swagger express route APIs, like /path/:param
    // as express router would attach route.path to request
    if (!('match' in ctx.sws) || !ctx.sws.match) {
        apiOpStats.countRequest(ctx.sws.req_clength);
    }

    // In all cases, count response here
    apiOpStats.countResponse(ctx.res.statusCode, codeclass, ctx.sws.duration, ctx.sws.res_clength);

    // Count metrics
    var apiOpDetails = this.getApiOpDetails(ctx.sws.api_path, ctx.method);

    // Metrics by response code
    if (!('code' in apiOpDetails)) {
        apiOpDetails.code = {};
    }

    if (!(ctx.res.statusCode in apiOpDetails.code)) {
        apiOpDetails.code[ctx.res.statusCode] = { count: 0 };
    }

    apiOpDetails.code[ctx.res.statusCode].count++;
    apiOpDetails.duration.countValue(ctx.sws.duration);
    apiOpDetails.req_size.countValue(ctx.sws.req_clength);
    apiOpDetails.res_size.countValue(ctx.sws.res_clength);

    // update Prometheus metrics
    this.promClientMetrics.api_request_total.labels(ctx.method, ctx.sws.api_path, ctx.res.statusCode).inc();

    this.promClientMetrics.api_request_duration_milliseconds.labels(ctx.method, ctx.sws.api_path, ctx.res.statusCode).observe(ctx.sws.duration);
    this.promClientMetrics.api_request_size_bytes.labels(ctx.method, ctx.sws.api_path, ctx.res.statusCode).observe(ctx.sws.req_clength);
    this.promClientMetrics.api_response_size_bytes.labels(ctx.method, ctx.sws.api_path, ctx.res.statusCode).observe(ctx.sws.res_clength);

    this.promClientMetrics.api_request_duration.labels(ctx.method, ctx.sws.api_path, ctx.response.status).set(ctx.sws.duration);
};

module.exports = swsAPIStats;
