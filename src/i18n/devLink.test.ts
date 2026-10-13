import { parseDevLocaleLink } from './devLink';

describe('parseDevLocaleLink', () => {
  it.each([
    ['shopping-list://dev/locale/de', 'de'],
    ['shopping-list://dev/locale/sr-Latn', 'sr-Latn'],
    ['shopping-list://dev/locale/pt-PT', 'pt-PT'],
    ['shopping-list://dev/locale/pseudo', 'pseudo'],
    ['shopping-list://dev/locale/device', 'device'],
    ['shopping-list://dev/locale/de/', 'de'],
  ])('reads %s', (url, target) => {
    expect(parseDevLocaleLink(url)).toBe(target);
  });

  it.each([
    'shopping-list://dev/locale/xx',
    'shopping-list://dev/locale/pt',
    'shopping-list://dev/locale/',
    'shopping-list://dev/theme/night',
    'other-app://dev/locale/de',
    'exp+shopping-list://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081',
  ])('ignores %s', (url) => {
    expect(parseDevLocaleLink(url)).toBeNull();
  });
});
