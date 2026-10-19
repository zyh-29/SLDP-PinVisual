// Adds build-time settings to app.json (which holds everything else).
//
// WEB_BASE_URL: set it when the web app is hosted in a folder of a website rather than at its root, e.g.
//   WEB_BASE_URL=/pinvisual npm run build:web   ->  https://example.com/pinvisual/
// Leave it unset for a site's root (or its own subdomain).
module.exports = ({ config }) => {
  const base = process.env.WEB_BASE_URL?.trim().replace(/\/+$/, '');
  if (!base) return config;
  return {
    ...config,
    experiments: { ...config.experiments, baseUrl: base.startsWith('/') ? base : `/${base}` },
  };
};
