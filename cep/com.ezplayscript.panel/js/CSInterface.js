/* 最小 CSInterface：仅封装 evalScript（调用 ExtendScript）。
 * PR 面板启用了 Node，因此扩展路径直接用 Node 的 __dirname，无需 getSystemPath。 */
function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
  if (typeof callback !== 'function') callback = function () {};
  if (typeof window !== 'undefined' && window.__adobe_cep__) {
    window.__adobe_cep__.evalScript(script, callback);
  } else {
    callback('ERR:not running inside a CEP host');
  }
};

// SystemPath 常量（CEP 内置）
CSInterface.SystemPath = {
  EXTENSION: 0,
  COMMON_FILES: 1,
  MY_DOCUMENTS: 2,
  APPLICATION: 3,
  USER_DATA: 4,
};

CSInterface.prototype.getSystemPath = function (which) {
  try {
    if (typeof window !== 'undefined' && window.__adobe_cep__) {
      return decodeURI(window.__adobe_cep__.getSystemPath(which));
    }
  } catch (e) { /* fall through */ }
  return '';
};

CSInterface.prototype.getHostEnvironment = function () {
  try { return JSON.parse(window.__adobe_cep__.getHostEnvironment()); }
  catch (e) { return null; }
};
