/**
 * 관리자 페이지 v2 - 단가 및 쿼터 설정
 */

// LLM 모델별 단가 (USD per 1K tokens)
const LLM_PRICING = {
  'gpt-4': {
    input: 0.03,
    output: 0.06
  },
  'gpt-4-turbo': {
    input: 0.01,
    output: 0.03
  },
  'gpt-3.5-turbo': {
    input: 0.0015,
    output: 0.002
  },
  'gpt-3.5-turbo-16k': {
    input: 0.003,
    output: 0.004
  }
};

// 스토리지 단가
const STORAGE_PRICING = {
  s3: 0.023, // USD per GB-month
  mongodb: 0.08 // USD per GB-month (Atlas)
};

// 플랜별 쿼터
const PLAN_QUOTAS = {
  basic: {
    maxPdf: 10,
    maxPages: 100,
    maxTokens: 100000
  },
  trial: {
    maxPdf: 50,
    maxPages: 500,
    maxTokens: 500000,
    durationDays: 7
  },
  pro: {
    maxPdf: -1, // 무제한
    maxPages: -1,
    maxTokens: -1
  }
};

// 플랜별 가격 (월간, USD)
const PLAN_PRICES = {
  basic: 0,
  trial: 0,
  pro: 29.99
};

/**
 * LLM 비용 계산
 * @param {string} model - LLM 모델명
 * @param {number} inputTokens - 입력 토큰 수
 * @param {number} outputTokens - 출력 토큰 수
 * @returns {number} - 비용 (USD)
 */
function calculateLLMCost(model, inputTokens, outputTokens) {
  const pricing = LLM_PRICING[model] || LLM_PRICING['gpt-3.5-turbo'];

  const inputCost = (inputTokens / 1000) * pricing.input;
  const outputCost = (outputTokens / 1000) * pricing.output;

  return inputCost + outputCost;
}

/**
 * 스토리지 비용 계산
 * @param {number} sizeGB - 저장 용량 (GB)
 * @param {string} type - 스토리지 타입 (s3 | mongodb)
 * @returns {number} - 월간 비용 (USD)
 */
function calculateStorageCost(sizeGB, type = 's3') {
  const pricing = STORAGE_PRICING[type] || STORAGE_PRICING.s3;
  return sizeGB * pricing;
}

/**
 * 사용자의 총 비용 추정
 * @param {Object} usage - 사용량 정보
 * @returns {Object} - { llmCost, storageCost, totalCost }
 */
function estimateUserCost(usage) {
  const {
    llmCalls = [],
    storageSizeGB = 0
  } = usage;

  // LLM 비용
  let llmCost = 0;
  for (const call of llmCalls) {
    llmCost += calculateLLMCost(
      call.model || 'gpt-3.5-turbo',
      call.inputTokens || 0,
      call.outputTokens || 0
    );
  }

  // 스토리지 비용
  const storageCost = calculateStorageCost(storageSizeGB);

  return {
    llmCost: Math.round(llmCost * 100) / 100,
    storageCost: Math.round(storageCost * 100) / 100,
    totalCost: Math.round((llmCost + storageCost) * 100) / 100
  };
}

/**
 * MRR (Monthly Recurring Revenue) 계산
 * @param {Array} paidUsers - 유료 사용자 배열
 * @returns {number} - MRR (USD)
 */
function calculateMRR(paidUsers) {
  return paidUsers.reduce((sum, user) => {
    const planPrice = PLAN_PRICES[user.plan] || 0;
    return sum + planPrice;
  }, 0);
}

/**
 * ARR (Annual Recurring Revenue) 계산
 * @param {number} mrr - MRR
 * @returns {number} - ARR (USD)
 */
function calculateARR(mrr) {
  return mrr * 12;
}

/**
 * ARPU (Average Revenue Per User) 계산
 * @param {number} totalRevenue - 총 매출
 * @param {number} totalUsers - 총 사용자 수
 * @returns {number} - ARPU (USD)
 */
function calculateARPU(totalRevenue, totalUsers) {
  if (totalUsers === 0) return 0;
  return Math.round((totalRevenue / totalUsers) * 100) / 100;
}

/**
 * 쿼터 사용률 계산
 * @param {Object} user - 사용자 정보
 * @param {Object} usage - 사용량 정보
 * @returns {Object} - { pdf, pages, tokens } (0-100%)
 */
function calculateQuotaUsage(user, usage) {
  const quota = PLAN_QUOTAS[user.plan] || PLAN_QUOTAS.basic;

  const pdfUsage = quota.maxPdf === -1 ? 0 : Math.min((usage.pdfCount / quota.maxPdf) * 100, 100);
  const pageUsage = quota.maxPages === -1 ? 0 : Math.min((usage.pageCount / quota.maxPages) * 100, 100);
  const tokenUsage = quota.maxTokens === -1 ? 0 : Math.min((usage.tokenCount / quota.maxTokens) * 100, 100);

  return {
    pdf: Math.round(pdfUsage),
    pages: Math.round(pageUsage),
    tokens: Math.round(tokenUsage)
  };
}

module.exports = {
  LLM_PRICING,
  STORAGE_PRICING,
  PLAN_QUOTAS,
  PLAN_PRICES,
  calculateLLMCost,
  calculateStorageCost,
  estimateUserCost,
  calculateMRR,
  calculateARR,
  calculateARPU,
  calculateQuotaUsage
};

