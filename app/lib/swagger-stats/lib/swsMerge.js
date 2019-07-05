
module.exports._mergeAll = function (prev, cur, size) {

  prev.apdex_satisfied = (prev.apdex_satisfied + cur.apdex_satisfied) / size;
  prev.apdex_score = (prev.apdex_score + cur.apdex_score) / size;
  prev.apdex_threshold = (prev.apdex_threshold + cur.apdex_threshold) / size;
  prev.apdex_tolerated = (prev.apdex_tolerated + cur.apdex_tolerated) / size;
  prev.avg_req_clength = (prev.avg_req_clength + cur.avg_req_clength) / size;
  prev.avg_res_clength = (prev.avg_res_clength + cur.avg_res_clength) / size;
  prev.avg_time = (prev.avg_time + cur.avg_time) / size;

  prev.client_error = (prev.client_error + cur.client_error) / size;
  prev.err_rate = (prev.err_rate + cur.err_rate) / size;
  prev.info = (prev.info + cur.info) / size;

  prev.max_req_clength = prev.max_req_clength > cur.max_req_clength ? prev.max_req_clength : cur.max_req_clength;
  prev.max_res_clength = prev.max_res_clength > cur.max_res_clength ? prev.max_res_clength : cur.max_res_clength;
  prev.max_time = prev.max_time > cur.max_time ? prev.max_time : cur.max_time;

  prev.redirect = prev.redirect + cur.redirect;

  prev.req_rate = (prev.req_rate + cur.req_rate) / size;
  prev.requests = prev.requests + cur.requests;
  prev.responses = prev.responses + cur.responses;

  prev.server_error = prev.server_error + cur.server_error;

  prev.responses = prev.responses + cur.responses;
  prev.success = prev.success + cur.success;

  prev.total_req_clength = prev.total_req_clength + cur.total_req_clength;

  prev.total_res_clength = prev.total_res_clength + cur.total_res_clength;
  prev.total_time = prev.total_time + cur.total_time;

  return prev;
}

module.exports.mergeStats = function (prev, cur, size) {

  module.exports._mergeAll(prev, cur, size);

  const prevRoutes = Object.keys(prev.apistats);
  for (const route of prevRoutes) {
    const prevMethods = Object.keys(prev.apistats[route]);

    if (cur.apistats[route]) {

      for (const method of prevMethods) {
        if (cur.apistats[route][method]) {
          // merge
          module.exports._merge(prev.apistats[route][method], cur.apistats[route][method], 2);
        }
      }
      for (const curMethod of Object.keys(cur.apistats[route])) {
        if (!prev.apistats[route][curMethod]) {
          // assign to prev.apistats[route]
          Object.assign(prev.apistats[route], { [curMethod]: cur.apistats[route][curMethod] });
        }
      }
    }
  }
  for (const route in cur.apistats) {
    if (!prev.apistats[route]) {
      // assign to prev.apistats[route]
      Object.assign(prev.apistats, { [route]: cur.apistats[route] });
    }
  }

  return prev;
}

module.exports.mergeTimeLine = function (prev, cur, size) {

  module.exports._mergeAll(prev.all, cur.all, size);
  prev.startts = prev.startts > cur.startts ? cur.startts : prev.startts;


  const prevTimePoints = Object.keys(prev.timeline.data);

  for (const tp of prevTimePoints) {
    if (cur.timeline.data[tp]) {
      module.exports._mergeAll(prev.timeline.data[tp].stats, cur.timeline.data[tp].stats, size);
    }
  }

  for (const tp in cur.timeline.data) {
    if (!prev.timeline.data[tp]) {
      // assign to prev.apistats[route]
      Object.assign(prev.timeline.data, { [tp]: cur.timeline.data[tp] });
    }
  }
  return prev;

}

module.exports.mergeLongestReq = function (prev, cur, size) {

  module.exports._mergeAll(prev.all, cur.all, size);

  prev.startts = prev.startts > cur.startts ? cur.startts : prev.startts;

  for (const req of cur.longestreq) {

    let inPrevReq = false;
    for (let i = 0; i < prev.longestreq.length; i++) {
      if (req.path === prev.longestreq[i].path) {
        // compare 
        if (req.responsetime > prev.longestreq[i].responsetime) {
          prev.longestreq[i] = req;
        }
        inPrevReq = true;
        break;
      }
    }
    if (!inPrevReq) {
      // push to prev
      prev.longestreq.push(req);
    }
  }
  return prev;
}

module.exports.mregeLastErrors = function (prev, cur, size) {

  module.exports._mergeAll(prev.all, cur.all, size);

  prev.startts = prev.startts > cur.startts ? cur.startts : prev.startts;

  for (const req of cur.lasterrors) {

    let inPrevReq = false;
    for (let i = 0; i < prev.lasterrors.length; i++) {
      if (req.path === prev.lasterrors[i].path) {
        // compare 
        if (req.endts > prev.lasterrors[i].endts) {
          prev.lasterrors[i] = req;
        }
        inPrevReq = true;
        break;
      }
    }
    if (!inPrevReq) {
      // push to prev
      prev.lasterrors.push(req);
    }
  }
  return prev;
}

module.exports.mergeErrors = function (prev, cur, size) {

  module.exports._mergeAll(prev.all, cur.all, size);
  prev.startts = prev.startts > cur.startts ? cur.startts : prev.startts;


  for (const type in prev.errors) {

    if (cur.errors[type]) {
      for (const key in prev.errors[type]) {
        if (cur.errors[type][key]) {
          prev.errors[type][key] = prev.errors[type][key] + cur.errors[type][key];
        }
      }
      for (const key in cur.errors[type]) {
        if (!prev.errors[type][key]) {
          prev.errors[type][key] = cur.errors[type][key];
        }
      }

    }
  }

  for (const type in cur.errors) {
    if (!prev.errors[type]) {
      prev.errors[type] = cur.errors[type];
    }
  }
  return prev;
}

module.exports.mergeMethod = function (prev, cur, size) {

  module.exports._mergeAll(prev.all, cur.all, size);
  prev.startts = prev.startts > cur.startts ? cur.startts : prev.startts;

  for (const method in prev.method) {

    if (cur.method[method]) {
      module.exports._mergeAll(prev.method[method], cur.method[method], size);
    }
  }

  for (const method in cur.method) {
    if (!prev.method[method]) {
      prev.method[method] = cur.method[method];
    }
  }
  return prev;
}

module.exports.mergeApiOp = function (prev, cur, size) {

  module.exports._mergeAll(prev.all, cur.all, size);
  prev.startts = prev.startts > cur.startts ? cur.startts : prev.startts;

  return prev;

}