'use strict';

const mock = require('egg-mock');

describe('test/egg-swagger-stats.test.js', () => {
  let app;
  before(() => {
    app = mock.app({
      baseDir: 'apps/egg-swagger-stats-test',
    });
    return app.ready();
  });

  after(() => app.close());
  afterEach(mock.restore);

  it('should GET /', () => {
    return app.httpRequest()
      .get('/')
      .expect('hi, eggSwaggerStats')
      .expect(200);
  });
});
