import { useEffect } from 'react';

function ensureLink(rel: string) {
  let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  return link;
}

function ensureThemeMeta() {
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  return meta;
}

export function useFleetPwaMeta() {
  useEffect(() => {
    const previousTitle = document.title;
    const manifestLink = ensureLink('manifest');
    const appleTouchLink = ensureLink('apple-touch-icon');
    const themeMeta = ensureThemeMeta();

    const previousManifestHref = manifestLink.href;
    const previousAppleHref = appleTouchLink.href;
    const previousTheme = themeMeta.content;

    document.title = 'SOLIDGO Frota';
    manifestLink.href = '/manifest-fleet.webmanifest';
    appleTouchLink.href = '/fleet-apple-touch-icon.png';
    themeMeta.content = '#0f172a';

    return () => {
      document.title = previousTitle;
      manifestLink.href = previousManifestHref;
      appleTouchLink.href = previousAppleHref;
      themeMeta.content = previousTheme;
    };
  }, []);
}
