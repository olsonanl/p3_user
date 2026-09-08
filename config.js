var nconf = require('nconf')

var defaults = {
  'http_port': 3002,

  'mongo': {
    'url': ''
  },
  'siteURL': 'http://user.patric.local:3002',
  'p3Home': 'http://patricbrc.org',
  'signing_PEM': 'private.pem',
  'signing_public_PEM': 'public.pem',
  'default_source': 'bvbrc',

  'realm_map': {
    'patricbrc.org': "patricbrc.org",
    "viprbrc": "bvbrc",
    "bvbrc": "bvbrc" 
  },
  'email': {
    'localSendmail': false,
    'defaultFrom': 'PATRIC <do-not-reply@patricbrc.org>',
    'defaultSender': 'PATRIC <do-not-reply@patricbrc.org>',
    'host': '',
    'port': 587
  },
  'userTokenDuration': 24,
  'serviceTokenDuration': 24 * 31,

  /*
   * Origins permitted to make *credentialed* cross-origin requests. Anonymous
   * cross-origin access stays open to every origin, which is load-bearing:
   * the website runs on a different registrable domain than this service and
   * calls it for login, refresh, registration and profile reads. See
   * corsOptions.js.
   *
   * Exact-match serialized origins, enumerated explicitly: BV-BRC uses
   * alpha./beta./dev-N. while the sibling properties use dev./test., so no
   * interpolation over a property name is correct for all of them. This is
   * the same list the OAuth2 redirect_uri registration needs; keep them in
   * sync (PLAN-oauth2-migration.md in bvbrc_website).
   *
   * Empty by default, which reproduces today's production behavior exactly:
   * Access-Control-Allow-Credentials is currently never sent by this service.
   */
  'cors_origins': []
}

module.exports = nconf.argv().env().file(process.env.P3_USER_CONFIG ||'./p3-user.conf').defaults(defaults)
