/**
 * Online picture search (only when the user turned on Online Picture Search): openly licensed pictures from
 * Openverse and Wikimedia Commons. Both are free, need no account or key, and allow pictures to be read from a web
 * page (CORS). All the searches run at once; one being slow or down doesn't stop the others.
 *
 * Silhouettes come first: one solid dark shape of the thing on a plain background, which is what 30 pins can show
 * (a photo of an apple tree becomes scattered pins; an apple's silhouette becomes an apple). Ordinary photos follow,
 * for things nobody has drawn a silhouette of.
 */
export interface Picture {
  /** A copy about 800 px wide, enough for 30 pins. */
  uri: string;
  title: string;
  creator: string | null;
  /** e.g. "CC BY 2.0", "CC0", "Public domain". */
  license: string;
  source: 'Openverse' | 'Wikimedia Commons';
}

const TIMEOUT_MS = 10_000;
const PER_SOURCE = 10;
/** Of each kind (silhouettes, then photos), at most this many from each source. */
const PER_KIND = 6;

const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** "File:Cat_on_snow.jpg" -> "Cat on snow". */
const cleanTitle = (t: string) =>
  t
    .replace(/^File:/, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/_/g, ' ')
    .trim();

async function getJson(url: string, outer?: AbortSignal): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const stop = () => ctrl.abort();
  outer?.addEventListener('abort', stop);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', stop);
  }
}

interface OpenverseResult {
  title?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  thumbnail?: string;
  url?: string;
}

export function openverseLicense(license?: string, version?: string): string {
  const l = (license ?? '').toLowerCase();
  if (l === 'cc0') return 'CC0';
  if (l === 'pdm') return 'Public domain';
  return `CC ${l.toUpperCase()}${version ? ` ${version}` : ''}`.trim();
}

export async function searchOpenverse(query: string, signal?: AbortSignal): Promise<Picture[]> {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${PER_SOURCE}&mature=false`;
  const data = (await getJson(url, signal)) as { results?: OpenverseResult[] };
  return (data.results ?? [])
    .filter((r) => r.thumbnail || r.url)
    .map((r) => ({
      uri: r.thumbnail ?? r.url!,
      title: r.title?.trim() || query,
      creator: r.creator?.trim() || null,
      license: openverseLicense(r.license, r.license_version),
      source: 'Openverse' as const,
    }));
}

interface WikiPage {
  index?: number;
  title: string;
  imageinfo?: { thumburl?: string; mime?: string; extmetadata?: Record<string, { value?: string }> }[];
}

/**
 * `kind`: 'photo' (bitmap files) or 'drawing' (SVG drawings, which Commons serves as PNG previews; most clean
 * silhouettes are drawings).
 */
export async function searchWikimedia(query: string, signal?: AbortSignal, kind: 'photo' | 'drawing' = 'photo'): Promise<Picture[]> {
  const drawings = kind === 'drawing';
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `${query} filetype:${drawings ? 'drawing' : 'bitmap'}`,
    gsrnamespace: '6',
    gsrlimit: String(PER_SOURCE),
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '800',
  });
  const data = (await getJson(`https://commons.wikimedia.org/w/api.php?${params}`, signal)) as { query?: { pages?: Record<string, WikiPage> } };
  return Object.values(data.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((p) => {
      const info = p.imageinfo?.[0];
      const kinds = drawings ? /^image\/(jpeg|png|webp|gif|svg\+xml)$/ : /^image\/(jpeg|png|webp|gif)$/;
      if (!info?.thumburl || !kinds.test(info.mime ?? '')) return [];
      const meta = info.extmetadata ?? {};
      return [
        {
          uri: info.thumburl,
          title: stripTags(meta.ObjectName?.value ?? '') || cleanTitle(p.title),
          creator: stripTags(meta.Artist?.value ?? '') || null,
          license: stripTags(meta.LicenseShortName?.value ?? '') || 'See Wikimedia Commons',
          source: 'Wikimedia Commons' as const,
        },
      ];
    });
}

/** Lists taken in turn (the best of each first), without repeats. */
function interleave(lists: Picture[][], seen: Set<string>): Picture[] {
  const out: Picture[] = [];
  for (let i = 0; i < PER_KIND; i++)
    for (const list of lists) {
      const p = list[i];
      if (p && !seen.has(p.uri)) {
        seen.add(p.uri);
        out.push(p);
      }
    }
  return out;
}

/**
 * Whether a picture's title names what was asked for (each word of 3 letters or more, plural or not). Silhouette
 * searches return look-alikes otherwise: "star silhouette" also finds a woman's silhouette and maps of countries.
 */
export function mentions(title: string, query: string): boolean {
  const t = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return words.length > 0 && words.every((w) => t.includes(` ${w.replace(/(es|s)$/, '')}`));
}

/**
 * Drawn silhouettes first (one solid shape on a plain background), then silhouette photos (the thing against the
 * light), then ordinary photos for anything nobody has drawn. Silhouettes count only when their title names the
 * thing. Throws only when no search answered.
 */
export async function searchPictures(query: string, signal?: AbortSignal): Promise<Picture[]> {
  const solid = `${query} silhouette`;
  const all = await Promise.allSettled([
    searchWikimedia(solid, signal, 'drawing'),
    searchOpenverse(solid, signal),
    searchWikimedia(solid, signal),
    searchOpenverse(query, signal),
    searchWikimedia(query, signal),
  ]);
  if (all.every((r) => r.status === 'rejected')) throw new Error('Picture search is not reachable. Check the internet connection.');
  const [drawn, ovSolid, wmSolid, ovPhoto, wmPhoto] = all.map((r) => (r.status === 'fulfilled' ? r.value : []));
  // Plainest titles first: "House silhouette" is more likely just a house than "House cat silhouette (NIH …)".
  const words = (t: string) => t.split(/\s+/).length;
  const about = (list: Picture[]) =>
    list
      .filter((p) => mentions(p.title, query))
      .map((p, i) => ({ p, i }))
      .sort((a, b) => words(a.p.title) - words(b.p.title) || a.i - b.i)
      .map((x) => x.p);
  const seen = new Set<string>();
  return [
    ...interleave([about(drawn), about(ovSolid)], seen),
    ...interleave([about(wmSolid)], seen),
    ...interleave([ovPhoto, wmPhoto], seen),
  ];
}

/** How a picture is credited, spoken and shown: "Cat on snow, by Von.grzanka, CC BY-SA 3.0, from Wikimedia Commons". */
export function credit(p: Picture): string {
  return `${p.title}${p.creator ? `, by ${p.creator}` : ''}, ${p.license}, from ${p.source}`;
}
