import { credit, mentions, openverseLicense, searchPictures } from '../pictureSearch';

const openverse = {
  results: [
    { title: 'Tabby', creator: 'Ann', license: 'by', license_version: '2.0', thumbnail: 'https://api.openverse.org/v1/images/1/thumb/' },
    { title: 'Kitten', creator: '', license: 'cc0', thumbnail: 'https://api.openverse.org/v1/images/2/thumb/' },
  ],
};
const wikimedia = {
  query: {
    pages: {
      '9': {
        index: 2,
        title: 'File:Cat_on_snow.jpg',
        imageinfo: [{ thumburl: 'https://upload.wikimedia.org/b.jpg', mime: 'image/jpeg', extmetadata: { Artist: { value: '<a href="x">Von</a>' }, LicenseShortName: { value: 'CC BY-SA 3.0' } } }],
      },
      '8': {
        index: 1,
        title: 'File:Cat_drawing.svg',
        imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a.png', mime: 'image/svg+xml' }],
      },
    },
  },
};

const respond = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response);

describe('picture search', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const page = (title: string, uri: string, mime = 'image/svg+xml') => ({
    index: 1,
    title,
    imageinfo: [{ thumburl: uri, mime, extmetadata: { LicenseShortName: { value: 'CC0' } } }],
  });
  const drawings = { query: { pages: { '1': page('File:Cat_silhouette.svg', 'https://u/cat-sil.png'), '2': { ...page('File:Woman_silhouette.svg', 'https://u/woman.png'), index: 2 } } } };
  const silhouettePhotos = { query: { pages: { '1': page('File:Cat_in_silhouette.jpg', 'https://u/cat-dusk.jpg', 'image/jpeg') } } };
  const route = (url: string) => {
    const q = decodeURIComponent(url).replace(/\+/g, ' ');
    if (url.includes('openverse')) return respond(q.includes('silhouette') ? { results: [] } : openverse);
    if (q.includes('cat silhouette filetype:drawing')) return respond(drawings);
    if (q.includes('cat silhouette filetype:bitmap')) return respond(silhouettePhotos);
    return respond(wikimedia);
  };

  it('drawn silhouettes first, then silhouette photos, then photos; only silhouettes that name the thing', async () => {
    global.fetch = jest.fn(route) as unknown as typeof fetch;
    const found = await searchPictures('cat');
    expect(found.map((p) => p.title)).toEqual(['Cat silhouette', 'Cat in silhouette', 'Tabby', 'Cat on snow', 'Kitten']);
    expect(credit(found[2])).toBe('Tabby, by Ann, CC BY 2.0, from Openverse');
    expect(credit(found[3])).toBe('Cat on snow, by Von, CC BY-SA 3.0, from Wikimedia Commons');
    expect(credit(found[4])).toBe('Kitten, CC0, from Openverse');
  });

  it('photo searches leave out drawings', async () => {
    global.fetch = jest.fn(route) as unknown as typeof fetch;
    expect((await searchPictures('cat')).some((p) => p.title === 'Cat drawing')).toBe(false);
  });

  it('one source down: the other still answers', async () => {
    global.fetch = jest.fn((url: string) => (url.includes('openverse') ? Promise.reject(new Error('down')) : route(url))) as unknown as typeof fetch;
    expect((await searchPictures('cat')).map((p) => p.title)).toEqual(['Cat silhouette', 'Cat in silhouette', 'Cat on snow']);
  });

  it('the plainest silhouette title comes first', async () => {
    const two = { query: { pages: { '1': page('File:House_cat_silhouette_(NIH_BioArt).svg', 'https://u/hc.png'), '2': { ...page('File:House_silhouette.svg', 'https://u/h.png'), index: 2 } } } };
    global.fetch = jest.fn((url: string) => respond(url.includes('filetype%3Adrawing') ? two : url.includes('openverse') ? { results: [] } : { query: { pages: {} } })) as unknown as typeof fetch;
    expect((await searchPictures('house')).map((p) => p.title)).toEqual(['House silhouette', 'House cat silhouette (NIH BioArt)']);
  });

  it('a title names the thing: plurals and several words', () => {
    expect(mentions('Cats silhouette', 'cat')).toBe(true);
    expect(mentions('Police car silhouette', 'police car')).toBe(true);
    expect(mentions('Woman silhouette TV', 'star')).toBe(false);
    expect(mentions('Mustard silhouette', 'star')).toBe(false);
  });

  it('everything down: a message about the connection', async () => {
    global.fetch = jest.fn(() => respond({}, false)) as unknown as typeof fetch;
    await expect(searchPictures('cat')).rejects.toThrow('Picture search is not reachable. Check the internet connection.');
  });

  it('licence names', () => {
    expect(openverseLicense('by-sa', '4.0')).toBe('CC BY-SA 4.0');
    expect(openverseLicense('pdm')).toBe('Public domain');
  });
});
