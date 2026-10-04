const maxSqlInteger = 2147483647;
const filtersByReport = Object.freeze({
  occupancy: ['branchId'],
  billing: ['branchId', 'outstandingOnly'],
  services: ['branchId'],
  revenue: ['branchId', 'year', 'month'],
  top: ['branchId', 'limit'],
});

function canReadReports(user) {
  return Boolean(user && user.type === 'staff'
    && ['Manager', 'Admin'].includes(user.role)
    && typeof user.id === 'number' && Number.isInteger(user.id)
    && user.id > 0 && user.id <= maxSqlInteger);
}

function validateReportQuery(report, query) {
  const allowed = Object.hasOwn(filtersByReport, report) ? filtersByReport[report] : null;
  if (!allowed || !query || typeof query !== 'object' || Array.isArray(query)
      || ![null, Object.prototype].includes(Object.getPrototypeOf(query))
      || Object.getOwnPropertySymbols(query).length) {
    return { error: 'Invalid report filters.' };
  }
  const value = {};
  for (const key of Object.keys(query)) {
    if (!allowed.includes(key)) return { error: 'Unsupported report filter.' };
    const raw = query[key];
    if (key === 'outstandingOnly') {
      if (raw !== 'true' && raw !== 'false') {
        return { error: 'outstandingOnly must be true or false.' };
      }
      value.outstandingOnly = raw === 'true';
      continue;
    }
    const maximum = key === 'year' ? 9999 : key === 'month' ? 12 : key === 'limit' ? 50 : maxSqlInteger;
    const minimum = key === 'year' ? 1000 : 1;
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)
        || Number(raw) < minimum || Number(raw) > maximum) {
      return { error: `${key} must be a whole number from ${minimum} to ${maximum}, without leading zeros.` };
    }
    value[key] = Number(raw);
  }
  if (value.month !== undefined && value.year === undefined) {
    return { error: 'Choose a year when filtering by month.' };
  }
  if (report === 'top' && value.limit === undefined) value.limit = 5;
  return { value };
}

module.exports = { canReadReports, validateReportQuery };
