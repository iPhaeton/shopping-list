/**
 * Expo's own preset — what Metro and jest-expo use when there is no config — plus Lingui's macro
 * plugin, which turns `<Trans>`, `t`, `msg` and `plural` into catalog lookups at build time.
 *
 * Lingui 6 ships only as ES modules. Metro and babel-jest load plugins synchronously, which works for
 * an ES module only because Node ≥ 22.12 lets `require()` load one.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['@lingui/babel-plugin-lingui-macro'],
  };
};
