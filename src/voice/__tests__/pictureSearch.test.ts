import { credit, openverseLicense, searchPictures } from '../pictureSearch';

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

  it('asks both, interleaves, skips drawings Wikimedia can only give as SVG, and keeps credits', async () => {
    global.fetch = jest.fn((url: string) => respond(url.includes('openverse') ? openverse : wikimedia)) as unknown as typeof fetch;
    const found = await searchPictures('cat');
    expect(found.map((p) => p.title)).toEqual(['Tabby', 'Cat on snow', 'Kitten']);
    expect(credit(found[0])).toBe('Tabby, by Ann, CC BY 2.0, from Openverse');
    expect(credit(found[1])).toBe('Cat on snow, by Von, CC BY-SA 3.0, from Wikimedia Commons');
    expect(credit(found[2])).toBe('Kitten, CC0, from Openverse');
  });

  it('one source down: the other still answers', async () => {
    global.fetch = jest.fn((url: string) => (url.includes('openverse') ? Promise.reject(new Error('down')) : respond(wikimedia))) as unknown as typeof fetch;
    expect((await searchPictures('cat')).map((p) => p.source)).toEqual(['Wikimedia Commons']);
  });

  it('both down: a message about the connection', async () => {
    global.fetch = jest.fn(() => respond({}, false)) as unknown as typeof fetch;
    await expect(searchPictures('cat')).rejects.toThrow('Picture search is not reachable. Check the internet connection.');
  });

  it('licence names', () => {
    expect(openverseLicense('by-sa', '4.0')).toBe('CC BY-SA 4.0');
    expect(openverseLicense('pdm')).toBe('Public domain');
  });
});
