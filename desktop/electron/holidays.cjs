const MIN_YEAR = 2007;
const MAX_YEAR = 2100;
const cache = new Map();

function normalizeHolidays(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('节假日接口返回格式异常');
  }
  return Object.fromEntries(
    Object.entries(data)
      .filter(([date, info]) =>
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        info && typeof info === 'object' &&
        typeof info.name === 'string' &&
        typeof info.isOffDay === 'boolean'
      )
      .map(([date, info]) => [date, { name: info.name, isOffDay: info.isOffDay }])
  );
}

async function getHolidays(year, request) {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new Error(`节假日年份需在 ${MIN_YEAR} 到 ${MAX_YEAR} 之间`);
  }
  if (cache.has(year)) return cache.get(year);

  const task = (async () => {
    const response = await request(`https://api.jiejiariapi.com/v1/holidays/${year}`);
    if (!response.ok) throw new Error(`节假日接口请求失败 (${response.status})`);
    return normalizeHolidays(await response.json());
  })();
  cache.set(year, task);
  try {
    return await task;
  } catch (error) {
    cache.delete(year);
    throw error;
  }
}

module.exports = { getHolidays, normalizeHolidays };

if (process.env.WORKBENCH_SELF_TEST === '1') {
  const normalized = normalizeHolidays({
    '2026-01-01': { name: '元旦', isOffDay: true, extra: 'ignored' },
    invalid: { name: '无效', isOffDay: true },
  });
  if (Object.keys(normalized).length !== 1 || !normalized['2026-01-01'].isOffDay) {
    throw new Error('holiday normalization failed');
  }
  console.log('holidays self-test ok');
}
