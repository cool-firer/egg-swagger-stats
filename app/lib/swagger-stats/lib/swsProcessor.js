/**
 * Created by sv2 on 2/18/17.
 * API usage statistics data
 */

'use strict';

var os = require('os');
var util = require('util');

var debug = require('debug')('sws:processor');
var debugrrr = require('debug')('sws:rrr');

var swsUtil = require('./swsUtil');
var pathToRegexp = require('path-to-regexp');
var moment = require('moment');

var swsReqResStats = require('./swsReqResStats');
var swsCoreStats = require('./swsCoreStats');
var swsErrors = require('./swsErrors');
var swsTimeline = require('./swsTimeline');
var swsAPIStats = require('./swsAPIStats');
var swsLastErrors = require('./swsLastErrors');
var swsLongestRequests = require('./swsLongestReq');

var swsElasticsearchEmitter = require('./swsElasticEmitter');

// Constructor
function swsProcessor() {

    // Name: Should be name of the service provided by this component
    this.name = 'sws';

    // Options
    this.options = null;

    // Version of this component
    this.version = '';

    // This node hostname
    this.nodehostname = '';

    // Node name: there could be multiple nodes in this service
    this.nodename = '';

    // Node address: there could be multiple nodes in this service
    this.nodeaddress = '';

    // onResponseFinish callback, if specified in options
    this.onResponseFinish = null;

    // If set to true via options, track only API defined in swagger spec
    this.swaggerOnly = false;

    // Core statistics
    this.coreStats = new swsCoreStats();

    // Timeline
    this.timeline = new swsTimeline();

    // API Stats
    this.apiStats = new swsAPIStats();

    // Errors
    this.errorsStats = new swsErrors();

    // Last Errors
    this.lastErrors = new swsLastErrors();

    // Longest Requests
    this.longestRequests = new swsLongestRequests();

    // ElasticSearch Emitter
    this.elasticsearchEmitter = new swsElasticsearchEmitter();
}

// Initialize
swsProcessor.prototype.init = function (swsOptions) {

    this.processOptions(swsOptions);

    this.coreStats.initialize(swsOptions);

    this.timeline.initialize(swsOptions);

    this.apiStats.initialize(swsOptions);

    this.elasticsearchEmitter.initialize(swsOptions);

    // Start tick
    setInterval(this.tick, 200, this);
};

swsProcessor.prototype.processOptions = function (swsOptions) {

    if(typeof swsOptions === 'undefined') return;
    if(!swsOptions) return;

    this.options = swsOptions;

    // Set or detect hostname
    if(swsUtil.supportedOptions.hostname in swsOptions) {
        this.hostname = swsOptions[swsUtil.supportedOptions.hostname];
    }else{
        this.hostname = os.hostname();
    }

    // Set name and version
    if(swsUtil.supportedOptions.name in swsOptions) {
        this.name = swsOptions[swsUtil.supportedOptions.name];
    }else{
        this.name = this.hostname;
    }

    if(swsUtil.supportedOptions.version in swsOptions) {
        this.version = swsOptions[swsUtil.supportedOptions.version];
    }

    // Set or detect node address
    if(swsUtil.supportedOptions.ip in swsOptions) {
        this.ip = swsOptions[swsUtil.supportedOptions.ip];
    }else{
        // Attempt to detect network address
        // Use first found interface name which starts from "e" ( en0, em0 ... )
        var address = null;
        var ifaces = os.networkInterfaces();
        for( var ifacename in ifaces ){
            var iface = ifaces[ifacename];
            if( !address && !iface.internal && (ifacename.charAt(0)=='e') ){
                if((iface instanceof Array) && (iface.length>0) ) {
                    address = iface[0].address;
                }
            }
        }
        this.ip = address ? address : '127.0.0.1';
    }

    if( swsOptions.onResponseFinish && (typeof swsOptions.onResponseFinish === 'function') ){
        this.onResponseFinish = swsOptions.onResponseFinish;
    }

    if(swsUtil.supportedOptions.swaggerOnly in swsOptions) {
        this.swaggerOnly = swsUtil.supportedOptions.swaggerOnly;
    }

};

// Tick - called with specified interval to refresh timelines
swsProcessor.prototype.tick = function (that) {

    var ts = Date.now();
    var totalElapsedSec = (ts - that.coreStats.startts)/1000;

    that.coreStats.tick(ts,totalElapsedSec);

    that.timeline.tick(ts,totalElapsedSec);

    that.apiStats.tick(ts,totalElapsedSec);

    that.elasticsearchEmitter.tick(ts,totalElapsedSec);

};

// Collect all data for request/response pair
// TODO Support option to add arbitrary extra properties to sws request/response record
swsProcessor.prototype.collectRequestResponseData = function (ctx) {

    var codeclass = swsUtil.getStatusCodeClass(ctx.res.statusCode);

    var rrr = {
        'path': ctx.originalUrl,
        'method': ctx.method,
        'query' : ctx.method + ' ' + ctx.originalUrl,
        'startts': 0,
        'endts': 0,
        'responsetime': 0,
        "node": {
            "name": this.name,
            "version": this.version,
            "hostname": this.hostname,
            "ip": this.ip
        },
        "http": {
            "request": {
                "url" : ctx.url
            },
            "response": {
                'code': ctx.res.statusCode,
                'class': codeclass,
                'phrase': ctx.res.statusMessage
            }
        }
    };

    // Request Headers
    if ("headers" in ctx) {
        rrr.http.request.headers = {};
        for(var hdr in ctx.headers){
            rrr.http.request.headers[hdr] = ctx.headers[hdr];
        }
        // TODO Split Cookies
    }

    // Response Headers
    if ("_headers" in ctx.res){
        rrr.http.response.headers = {};
        for(var hdr in ctx.res['_headers']){
            rrr.http.response.headers[hdr] = ctx.res['_headers'][hdr];
        }
    }

    // Additional details from collected info per request / response pair

    if ("sws" in ctx) {

        rrr.ip = ctx.sws.ip;
        rrr.real_ip = ctx.sws.real_ip;
        rrr.port = ctx.sws.port;

        rrr["@timestamp"] = moment(ctx.sws.startts).toISOString();
        //rrr.end = moment(req.sws.endts).toISOString();
        rrr.startts = ctx.sws.startts;
        rrr.endts = ctx.sws.endts;
        rrr.responsetime = ctx.sws.duration;
        rrr.http.request.clength = ctx.sws.req_clength;
        rrr.http.response.clength = ctx.sws.res_clength;
        rrr.http.request.route_path = ctx.sws.route_path;

        // Add detailed swagger API info
        rrr.api = {};
        rrr.api.path = ctx.sws.api_path;
        rrr.api.query = ctx.method + ' ' + ctx.sws.api_path;
        if( 'swagger' in ctx.sws ) rrr.api.swagger = ctx.sws.swagger;
        if( 'deprecated' in ctx.sws ) rrr.api.deprecated = ctx.sws.deprecated;
        if( 'operationId' in ctx.sws ) rrr.api.operationId = ctx.sws.operationId;
        if( 'tags' in ctx.sws ) rrr.api.tags = ctx.sws.tags;

        // Get API parameter values per definition in swagger spec
        var apiParams = this.apiStats.getApiOpParameterValues(ctx.sws.api_path,ctx.method,ctx);
        if(apiParams!==null){
            rrr.api.params = apiParams;
        }

        // TODO Support Arbitrary extra properties added to request under sws
        // So app can add any custom data to request, and it will be emitted in record

    }

    var req = ctx.request;
    // Express parameters: req.param and req.query
    if (req.hasOwnProperty("params")) {
        rrr.http.request.params = {};
        swsUtil.swsStringRecursive(rrr.http.request.params, req.params);
    }

    if (req.hasOwnProperty("query")) {
        rrr.http.request.query = {};
        swsUtil.swsStringRecursive(rrr.http.request.query, req.query);
    }

    if (req.hasOwnProperty("body")) {
        rrr.http.request.body = Object.assign({}, req.body);
        swsUtil.swsStringRecursive(rrr.http.request.body, req.body);
    }

    return rrr;
};


swsProcessor.prototype.getRemoteIP = function (ctx) {
    var ip = '';
    try {
        ip = ctx.ip;
    }catch(e){}
    return ip;
};

swsProcessor.prototype.getPort = function (ctx) {
    var p = 0;
    try{
        p = ctx.req.connection.localPort;
    }catch(e){}
    return p;
};


swsProcessor.prototype.getRemoteRealIP = function (ctx) {
    var remoteaddress = null;
    var xfwd = ctx.headers['x-forwarded-for'];
    if (xfwd) {
        var fwdaddrs = xfwd.split(','); // Could be "client IP, proxy 1 IP, proxy 2 IP"
        remoteaddress = fwdaddrs[0];
    }
    if (!remoteaddress) {
        remoteaddress = this.getRemoteIP(ctx);
    }
    return remoteaddress;
};

swsProcessor.prototype.processRequest = function (ctx) {

    // Placeholder for sws-specific attributes
    ctx.sws = {};

    // Setup sws props and pass to stats processors
    var ts = Date.now();

    var reqContentLength = 0;
    if('content-length' in ctx.headers) {
        reqContentLength = parseInt(ctx.headers['content-length']);
    }

    ctx.sws.track = true;
    ctx.sws.startts = ts;
    ctx.sws.timelineid = Math.floor( ts/ this.timeline.settings.bucket_duration );
    ctx.sws.req_clength = reqContentLength;
    ctx.sws.ip = this.getRemoteIP(ctx);
    ctx.sws.real_ip = this.getRemoteRealIP(ctx);
    ctx.sws.port = this.getPort(ctx);

    // Try to match to API right away
    this.apiStats.matchRequest(ctx);

    // if no match, and tracking of non-swagger requests is disabled, return
    if( !ctx.sws.match && this.swaggerOnly){
        ctx.sws.track = false;
        return;
    }

    // Core stats
    this.coreStats.countRequest(ctx);

    // Timeline
    this.timeline.countRequest(ctx);

    // TODO Check if needed
    this.apiStats.countRequest(ctx);

};

swsProcessor.prototype.processResponse = function (ctx) {

    // Capture route path for the request, if set by router
    var route_path = '';
    if (("route" in ctx.request) && ("path" in ctx.request.route)) {
        if (("baseUrl" in ctx.request) && (ctx.request.baseUrl != undefined)) route_path = ctx.request.baseUrl;
        route_path += ctx.route.path;
        ctx.sws.route_path = route_path;
    }

    // If request was not matched to Swagger API, set API path:
    // Use route_path, if exist; if not, use originalUrl
    if(!('api_path' in ctx.sws)){
        // ctx.sws.api_path = (route_path!=''?route_path:ctx.originalUrl);
        ctx.sws.api_path = typeof(ctx._matchedRoute) == 'undefined' ? (route_path != '' ? route_path : ctx.originalUrl) : ctx._matchedRoute;
    }

    // Pass through Core Statistics
    this.coreStats.countResponse(ctx);

    // Pass through Timeline
    this.timeline.countResponse(ctx);

    // Pass through API Statistics
    this.apiStats.countResponse(ctx);

    // Pass through Errors
    this.errorsStats.countResponse(ctx);

    // Collect request / response record
    var rrr = this.collectRequestResponseData(ctx);

    // Pass through last errors
    this.lastErrors.processReqResData(rrr);

    // Pass through longest request
    this.longestRequests.processReqResData(rrr);

    // Pass to app if callback is specified
    if(this.onResponseFinish !== null ){
        this.onResponseFinish(ctx, rrr);
    }

    // Push Request/Response Data to Emitter(s)
    this.elasticsearchEmitter.processRecord(rrr);

    //debugrrr('%s', JSON.stringify(rrr));
};


// Get stats according to fields and params specified in query
swsProcessor.prototype.getStats = function ( query ) {

    query = typeof query !== 'undefined' ? query: {};
    query = query !== null ? query: {};

    var statfields = [];    // Default

    // Check if we have query parameter "fields"
    if ('fields[]' in query) {
        if (query['fields[]'] instanceof Array) {
            statfields = query.fields;
        } else {
            var fieldsstr = query['fields[]'];
            statfields = fieldsstr.split(',');
        }
    }

    // core statistics are returned always
    var result = this.coreStats.getStats();

    // add standard properties, returned always
    result.name = this.name;
    result.version = this.version;
    result.hostname = this.hostname;
    result.ip = this.ip;
    result.apdexThreshold = this.options.apdexThreshold;

    var fieldMask = 0;
    for(var i=0;i<statfields.length;i++){
        var fld = statfields[i];
        if( fld in swsUtil.swsStatFields ) fieldMask |= swsUtil.swsStatFields[fld];
    }

    //console.log('Field mask:' + fieldMask.toString(2) );

    // Populate per mask
    if( fieldMask & swsUtil.swsStatFields.method )  result.method = this.coreStats.getMethodStats();
    if( fieldMask & swsUtil.swsStatFields.timeline )  result.timeline = this.timeline.getStats();
    if( fieldMask & swsUtil.swsStatFields.lasterrors )  result.lasterrors = this.lastErrors.getStats();
    if( fieldMask & swsUtil.swsStatFields.longestreq )  result.longestreq = this.longestRequests.getStats();
    if( fieldMask & swsUtil.swsStatFields.apidefs )  result.apidefs = this.apiStats.getAPIDefs();
    if( fieldMask & swsUtil.swsStatFields.apistats )  result.apistats = this.apiStats.getAPIStats();
    if( fieldMask & swsUtil.swsStatFields.errors )  result.errors = this.errorsStats.getStats();

    if( fieldMask & swsUtil.swsStatFields.apiop ) {
        if(("path" in query) && ("method" in query)) {
            result.apiop = this.apiStats.getAPIOperationStats(query.path, query.method);
        }
    }

    return result;
};

module.exports = swsProcessor;
