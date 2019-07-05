
'use strict';

const swStats = require('../lib/swagger-stats/lib');

module.exports = (options, app) => {
  return swStats.getMiddleware(options, app);
};
