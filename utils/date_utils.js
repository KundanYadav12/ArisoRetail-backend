/**
 * Indian Standard Time (IST — UTC+05:30 / Asia/Kolkata) Date & Time Utilities
 * Ensures consistent IST timestamps across all backend repositories, controllers, and services.
 */

// Force Node.js process timezone to IST
process.env.TZ = 'Asia/Kolkata';

/**
 * Returns current date or specified date formatted as YYYY-MM-DD in Asia/Kolkata (IST)
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} e.g. "2026-09-23"
 */
function getISTDateString(date = new Date()) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  } catch (err) {
    const d = new Date();
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }
}

/**
 * Returns YYYYMMDD in IST (ideal for document sequence prefixes like PO-YYYYMMDD-0001)
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} e.g. "20260923"
 */
function getISTDatePrefix(date = new Date()) {
  return getISTDateString(date).replace(/-/g, '');
}

/**
 * Returns current time formatted as HH:mm:ss in Asia/Kolkata (IST) 24h
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} e.g. "14:30:00"
 */
function getISTTimeString(date = new Date()) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  } catch (err) {
    return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  }
}

/**
 * Returns current datetime formatted as YYYY-MM-DD HH:mm:ss in Asia/Kolkata (IST)
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} e.g. "2026-09-23 14:30:00"
 */
function getISTDateTimeString(date = new Date()) {
  return `${getISTDateString(date)} ${getISTTimeString(date)}`;
}

/**
 * Safely format any database value (Date object, string) to a clean YYYY-MM-DD string in IST
 * @param {Date|string|null} val
 * @returns {string}
 */
function formatLocalDate(val) {
  if (!val) return '';
  if (typeof val === 'string' && val.length === 10 && val.includes('-')) return val;
  return getISTDateString(val);
}

module.exports = {
  getISTDateString,
  getISTDatePrefix,
  getISTTimeString,
  getISTDateTimeString,
  formatLocalDate
};
