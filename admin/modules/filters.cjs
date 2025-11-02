/**
 * 관리자 페이지 v2 - 필터 쿼리 파서
 * URL 쿼리 파라미터를 MongoDB 쿼리로 변환
 */

/**
 * URL 쿼리 파라미터를 파싱하여 MongoDB 필터 생성
 * @param {URLSearchParams} params - URL 쿼리 파라미터
 * @returns {Object} { userFilter, fileFilter, dateRange, pagination, sort }
 */
function parseFilters(params) {
  const filters = {
    userFilter: {},
    fileFilter: {},
    eventFilter: {},
    dateRange: {},
    pagination: {
      page: parseInt(params.get('page')) || 1,
      pageSize: Math.min(parseInt(params.get('pageSize')) || 50, 1000) // 최대 1000개
    },
    sort: params.get('sort') || 'createdAt',
    sortOrder: params.get('sortOrder') === 'asc' ? 1 : -1
  };

  // 날짜 범위 (기본: 최근 7일)
  const to = params.get('to') ? new Date(params.get('to')) : new Date();
  const from = params.get('from')
    ? new Date(params.get('from'))
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  filters.dateRange = { from, to };

  // 사용자 역할 필터
  const role = params.get('role');
  if (role && ['teacher', 'student', 'admin'].includes(role)) {
    filters.userFilter.role = role;
  }

  // 플랜 필터
  const plan = params.get('plan');
  if (plan) {
    const plans = plan.split(',').filter(p => ['basic', 'pro', 'trial'].includes(p));
    if (plans.length > 0) {
      filters.userFilter.plan = { $in: plans };
    }
  }

  // 유료 여부 필터
  const paid = params.get('paid');
  if (paid === 'true' || paid === '1') {
    filters.userFilter.isPaid = true;
  } else if (paid === 'false' || paid === '0') {
    filters.userFilter.isPaid = { $ne: true };
  } else if (paid === 'trial') {
    filters.userFilter.isTrial = true;
    filters.userFilter.isPaid = { $ne: true };
  }

  // 기관 필터
  const org = params.get('org');
  if (org) {
    filters.userFilter.organizationId = org;
  }

  // UTM 채널 필터
  const utm = params.get('utm');
  if (utm) {
    filters.userFilter.utmSource = utm;
  }

  // 활성 사용자만
  const activeOnly = params.get('activeOnly');
  if (activeOnly === '1' || activeOnly === 'true') {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    filters.userFilter.lastActiveAt = { $gte: sevenDaysAgo };
  }

  // 에러 경험자만
  const errorOnly = params.get('errorOnly');
  if (errorOnly === '1' || errorOnly === 'true') {
    filters.userFilter.hasError = true;
  }

  // 검색 (이메일, 이름, 도메인)
  const search = params.get('search');
  if (search && search.trim()) {
    const searchRegex = new RegExp(search.trim(), 'i');
    filters.userFilter.$or = [
      { email: searchRegex },
      { username: searchRegex },
      { 'email': { $regex: `@${search.trim()}`, $options: 'i' } } // 도메인 검색
    ];
  }

  // 사용량 필터 (집계 후 적용되므로 별도 저장)
  filters.usageFilter = {};

  const minPdf = parseInt(params.get('minPdf'));
  const maxPdf = parseInt(params.get('maxPdf'));
  if (!isNaN(minPdf)) filters.usageFilter.minPdf = minPdf;
  if (!isNaN(maxPdf)) filters.usageFilter.maxPdf = maxPdf;

  const minPages = parseInt(params.get('minPages'));
  const maxPages = parseInt(params.get('maxPages'));
  if (!isNaN(minPages)) filters.usageFilter.minPages = minPages;
  if (!isNaN(maxPages)) filters.usageFilter.maxPages = maxPages;

  const minTokens = parseInt(params.get('minTokens'));
  const maxTokens = parseInt(params.get('maxTokens'));
  if (!isNaN(minTokens)) filters.usageFilter.minTokens = minTokens;
  if (!isNaN(maxTokens)) filters.usageFilter.maxTokens = maxTokens;

  return filters;
}

/**
 * 필터를 해시화하여 캐시 키 생성
 * @param {Object} filters - 필터 객체
 * @returns {string} - 캐시 키
 */
function generateCacheKey(filters) {
  const crypto = require('crypto');
  const filterString = JSON.stringify(filters);
  return `admin_v2:${crypto.createHash('md5').update(filterString).digest('hex')}`;
}

/**
 * 사용량 필터 적용 (집계 후)
 * @param {Array} users - 사용자 배열 (사용량 포함)
 * @param {Object} usageFilter - 사용량 필터
 * @returns {Array} - 필터링된 사용자 배열
 */
function applyUsageFilter(users, usageFilter) {
  if (!usageFilter || Object.keys(usageFilter).length === 0) {
    return users;
  }

  return users.filter(user => {
    const { pdfCount = 0, pageCount = 0, tokenCount = 0 } = user;

    if (usageFilter.minPdf !== undefined && pdfCount < usageFilter.minPdf) return false;
    if (usageFilter.maxPdf !== undefined && pdfCount > usageFilter.maxPdf) return false;

    if (usageFilter.minPages !== undefined && pageCount < usageFilter.minPages) return false;
    if (usageFilter.maxPages !== undefined && pageCount > usageFilter.maxPages) return false;

    if (usageFilter.minTokens !== undefined && tokenCount < usageFilter.minTokens) return false;
    if (usageFilter.maxTokens !== undefined && tokenCount > usageFilter.maxTokens) return false;

    return true;
  });
}

/**
 * 입력 검증
 * @param {URLSearchParams} params
 * @returns {Object|null} - 오류 시 { error: string } 반환
 */
function validateParams(params) {
  // 날짜 검증
  const from = params.get('from');
  const to = params.get('to');

  if (from && isNaN(new Date(from))) {
    return { error: 'Invalid from date format' };
  }

  if (to && isNaN(new Date(to))) {
    return { error: 'Invalid to date format' };
  }

  // 페이지 크기 검증
  const pageSize = parseInt(params.get('pageSize'));
  if (pageSize && (pageSize < 1 || pageSize > 1000)) {
    return { error: 'pageSize must be between 1 and 1000' };
  }

  // 역할 검증
  const role = params.get('role');
  if (role && !['teacher', 'student', 'admin'].includes(role)) {
    return { error: 'Invalid role value' };
  }

  return null;
}

module.exports = {
  parseFilters,
  generateCacheKey,
  applyUsageFilter,
  validateParams
};

