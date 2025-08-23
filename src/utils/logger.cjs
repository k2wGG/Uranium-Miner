// src/utils/logger.cjs
/**
 * Простой логгер с цветами и метками времени.
 */

function color(s, code){ return `\x1b[${code}m${s}\x1b[0m`; }

const COLOR = { info:34, warn:33, error:31, debug:36, success:32 };

function log(message, level='info') {
  const ts = new Date().toISOString().slice(11, 19); // только HH:MM:SS
  const tag = level==='error'   ? color('ERR',COLOR.error)
            : level==='warn'    ? color('WRN',COLOR.warn)
            : level==='debug'   ? color('DBG',COLOR.debug)
            : level==='success' ? color('OK ',COLOR.success)
            : color('INF',COLOR.info);
  console.log(`${color(`[${ts}]`,36)} ${tag} ${message}`);
}

module.exports = { log };
