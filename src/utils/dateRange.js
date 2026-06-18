function parseDateBoundary(value, boundary) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const suffix = boundary === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z';
    return new Date(`${value}${suffix}`);
  }

  return new Date(value);
}

function buildTimestampWhere(startDate, endDate) {
  const where = {};
  const start = parseDateBoundary(startDate, 'start');
  const end = parseDateBoundary(endDate, 'end');

  if (start) {
    where.$start = start;
  }

  if (end) {
    where.$end = end;
  }

  return { start, end };
}

module.exports = {
  parseDateBoundary
};
