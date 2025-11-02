/**
 * 관리자 페이지 v2 - 통계 집계 로직
 */

const billing = require('./billing.cjs');

/**
 * 기본 통계 집계
 * @param {Object} db - MongoDB database instance
 * @param {Object} filters - 필터 객체
 * @returns {Promise<Object>} - 통계 객체
 */
async function aggregateStats(db, filters) {
  const { userFilter, dateRange } = filters;

  // 총 사용자 수
  const totalUsers = await db.collection('users').countDocuments(userFilter);

  // 유료 구독자 수
  const paidUsers = await db.collection('users').countDocuments({
    ...userFilter,
    isPaid: true
  });

  // 체험 사용자 수
  const trialUsers = await db.collection('users').countDocuments({
    ...userFilter,
    isTrial: true,
    isPaid: { $ne: true }
  });

  // 체험→유료 전환율
  const conversionRate = trialUsers > 0 ? Math.round((paidUsers / trialUsers) * 100) / 100 : 0;

  // 유료 사용자 리스트 가져오기 (MRR/ARR 계산용)
  const paidUsersList = await db.collection('users').find({
    ...userFilter,
    isPaid: true
  }).toArray();

  // MRR/ARR
  const mrr = billing.calculateMRR(paidUsersList);
  const arr = billing.calculateARR(mrr);

  // ARPU
  const arpu = billing.calculateARPU(mrr, totalUsers);

  // 오늘 매출 (payments 컬렉션)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let todayRevenue = 0;
  try {
    const todayPayments = await db.collection('payments').find({
      createdAt: { $gte: today },
      status: 'succeeded'
    }).toArray();

    todayRevenue = todayPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  } catch (e) {
    // payments 컬렉션이 없으면 0
  }

  // 실패 결제 수
  let failedPayments = 0;
  try {
    failedPayments = await db.collection('payments').countDocuments({
      createdAt: { $gte: dateRange.from, $lt: dateRange.to },
      status: { $in: ['failed', 'canceled'] }
    });
  } catch (e) {
    // payments 컬렉션이 없으면 0
  }

  // PDF 생성 수
  const pdfCount = await db.collection('files').countDocuments({
    uploadDate: { $gte: dateRange.from, $lt: dateRange.to }
  });

  // 처리 페이지 수
  const pageResult = await db.collection('problems').aggregate([
    {
      $lookup: {
        from: 'files',
        localField: 'fileId',
        foreignField: '_id',
        as: 'file'
      }
    },
    { $unwind: { path: '$file', preserveNullAndEmptyArrays: true } },
    {
      $match: {
        'file.uploadDate': { $gte: dateRange.from, $lt: dateRange.to }
      }
    },
    {
      $group: {
        _id: '$pageNumber',
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: null,
        totalPages: { $sum: 1 }
      }
    }
  ]).toArray();

  const totalPages = pageResult.length > 0 ? pageResult[0].totalPages : 0;

  // LLM 호출/토큰 (events 컬렉션이 있다면)
  let llmCalls = 0;
  let llmTokens = 0;
  let estimatedCost = 0;

  try {
    const llmEvents = await db.collection('events').aggregate([
      {
        $match: {
          type: 'llm_call',
          createdAt: { $gte: dateRange.from, $lt: dateRange.to }
        }
      },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          totalInputTokens: { $sum: '$inputTokens' },
          totalOutputTokens: { $sum: '$outputTokens' }
        }
      }
    ]).toArray();

    if (llmEvents.length > 0) {
      const event = llmEvents[0];
      llmCalls = event.totalCalls;
      llmTokens = (event.totalInputTokens || 0) + (event.totalOutputTokens || 0);

      // 비용 추정 (기본 gpt-3.5-turbo 기준)
      estimatedCost = billing.calculateLLMCost(
        'gpt-3.5-turbo',
        event.totalInputTokens || 0,
        event.totalOutputTokens || 0
      );
    }
  } catch (e) {
    // events 컬렉션이 없으면 0
  }

  // 방문자 통계 (visits 컬렉션)
  let todayVisitors = 0;
  let activeUsers = 0;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    todayVisitors = await db.collection('visits').countDocuments({
      timestamp: { $gte: today }
    });

    // 최근 24시간 내 활동 사용자
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    activeUsers = await db.collection('visits').distinct('userId', {
      timestamp: { $gte: oneDayAgo }
    }).then(arr => arr.length);
  } catch (e) {
    // visits 컬렉션이 없으면 0
  }

  // 파이프라인 성공률 (pipeline_runs 컬렉션)
  let pipelineSuccessRate = 0;
  let pipelineP95Ms = 0;
  let errorRate = 0;

  try {
    const pipelineStats = await db.collection('pipeline_runs').aggregate([
      {
        $match: {
          createdAt: { $gte: dateRange.from, $lt: dateRange.to }
        }
      },
      {
        $group: {
          _id: null,
          totalRuns: { $sum: 1 },
          successfulRuns: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          failedRuns: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          avgLatencyMs: { $avg: '$durationMs' },
          p95LatencyMs: { $percentile: { input: '$durationMs', p: [0.95], method: 'approximate' } }
        }
      }
    ]).toArray();

    if (pipelineStats.length > 0) {
      const stats = pipelineStats[0];
      pipelineSuccessRate = stats.totalRuns > 0
        ? Math.round((stats.successfulRuns / stats.totalRuns) * 10000) / 100
        : 0;
      pipelineP95Ms = Math.round(stats.p95LatencyMs?.[0] || stats.avgLatencyMs || 0);
      errorRate = stats.totalRuns > 0
        ? Math.round((stats.failedRuns / stats.totalRuns) * 10000) / 100
        : 0;
    }
  } catch (e) {
    // pipeline_runs 컬렉션이 없거나 $percentile 지원 안 하면 0
    // MongoDB 7.0+ 필요
  }

  return {
    users: totalUsers,
    paidUsers,
    trialUsers,
    conversions: conversionRate,
    mrr: Math.round(mrr * 100) / 100,
    arr: Math.round(arr * 100) / 100,
    arpu,
    todayRevenue: Math.round(todayRevenue * 100) / 100,
    failedPayments,
    pdfCount,
    totalPages,
    llmCalls,
    llmTokens,
    estimatedCost: Math.round(estimatedCost * 100) / 100,
    todayVisitors,
    activeUsers,
    pipelineSuccessRate,
    pipelineP95Ms,
    errorRate
  };
}

/**
 * 시계열 데이터 집계
 * @param {Object} db - MongoDB database instance
 * @param {Object} filters - 필터 객체
 * @param {string} interval - 'day' | 'week' | 'month'
 * @returns {Promise<Object>} - 시계열 데이터
 */
async function aggregateTimeseries(db, filters, interval = 'day') {
  const { userFilter, dateRange } = filters;

  // 날짜 레이블 생성
  const labels = generateDateLabels(dateRange.from, dateRange.to, interval);

  // 가입자 추이
  const userTrend = await db.collection('users').aggregate([
    {
      $match: {
        ...userFilter,
        createdAt: { $gte: dateRange.from, $lt: dateRange.to }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: interval === 'day' ? '%Y-%m-%d' : '%Y-%U',
            date: '$createdAt'
          }
        },
        total: { $sum: 1 },
        paid: {
          $sum: { $cond: [{ $eq: ['$isPaid', true] }, 1, 0] }
        },
        trial: {
          $sum: { $cond: [{ $eq: ['$isTrial', true] }, 1, 0] }
        }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  // PDF 변환 추이
  const conversionTrend = await db.collection('files').aggregate([
    {
      $match: {
        uploadDate: { $gte: dateRange.from, $lt: dateRange.to }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: interval === 'day' ? '%Y-%m-%d' : '%Y-%U',
            date: '$uploadDate'
          }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  // 방문자 추이
  let visitTrend = [];
  try {
    visitTrend = await db.collection('visits').aggregate([
      {
        $match: {
          timestamp: { $gte: dateRange.from, $lt: dateRange.to }
        }
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: interval === 'day' ? '%Y-%m-%d' : '%Y-%U',
                date: '$timestamp'
              }
            }
          },
          totalVisits: { $sum: 1 },
          uniqueVisitors: {
            $addToSet: '$userId'
          }
        }
      },
      {
        $project: {
          _id: '$_id.date',
          totalVisits: 1,
          uniqueVisitors: { $size: '$uniqueVisitors' }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();
  } catch (e) {
    // visits 컬렉션이 없으면 빈 배열
  }

  // 매출 추이 (payments 컬렉션)
  let revenueTrend = [];
  try {
    revenueTrend = await db.collection('payments').aggregate([
      {
        $match: {
          createdAt: { $gte: dateRange.from, $lt: dateRange.to },
          status: 'succeeded'
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: interval === 'day' ? '%Y-%m-%d' : '%Y-%U',
              date: '$createdAt'
            }
          },
          revenue: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();
  } catch (e) {
    // payments 컬렉션이 없으면 빈 배열
  }

  // 데이터 매핑
  const userData = mapTimeseriesData(labels, userTrend, 'total');
  const paidData = mapTimeseriesData(labels, userTrend, 'paid');
  const trialData = mapTimeseriesData(labels, userTrend, 'trial');
  const conversionData = mapTimeseriesData(labels, conversionTrend, 'count');
  const revenueData = mapTimeseriesData(labels, revenueTrend, 'revenue');
  const visitData = mapTimeseriesData(labels, visitTrend, 'totalVisits');
  const uniqueVisitorData = mapTimeseriesData(labels, visitTrend, 'uniqueVisitors');

  return {
    labels: labels.map(l => l.substring(5)), // MM-DD 형식
    users: userData,
    paid: paidData,
    trial: trialData,
    conversions: conversionData,
    revenue: revenueData,
    visits: visitData,
    uniqueVisitors: uniqueVisitorData
  };
}

/**
 * 테이블 데이터 집계 (페이징)
 * @param {Object} db - MongoDB database instance
 * @param {Object} filters - 필터 객체
 * @returns {Promise<Object>} - 테이블 데이터
 */
async function aggregateTables(db, filters) {
  const { userFilter, pagination, sort, sortOrder, usageFilter } = filters;

  // 사용자 리스트 (사용량 포함)
  const skip = (pagination.page - 1) * pagination.pageSize;
  const limit = pagination.pageSize;

  // 사용자와 사용량 조인
  const users = await db.collection('users').aggregate([
    { $match: userFilter },
    {
      $lookup: {
        from: 'files',
        localField: '_id',
        foreignField: 'userId',
        as: 'files'
      }
    },
    {
      $addFields: {
        pdfCount: { $size: '$files' },
        lastActivityAt: { $max: '$files.uploadDate' }
      }
    },
    { $sort: { [sort]: sortOrder } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        username: 1,
        email: 1,
        role: 1,
        plan: 1,
        isPaid: 1,
        createdAt: 1,
        lastActivityAt: 1,
        pdfCount: 1
      }
    }
  ]).toArray();

  const totalCount = await db.collection('users').countDocuments(userFilter);

  // 방문 로그 (최근 100개)
  let visitLogs = [];
  try {
    visitLogs = await db.collection('visits').aggregate([
      { $sort: { timestamp: -1 } },
      { $limit: 100 },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          timestamp: 1,
          ip: 1,
          userAgent: 1,
          username: { $ifNull: ['$user.username', '익명'] },
          email: { $ifNull: ['$user.email', '-'] }
        }
      }
    ]).toArray();
  } catch (e) {
    // visits 컬렉션이 없으면 빈 배열
  }

  return {
    users: users.map(u => ({
      username: u.username,
      email: u.email,
      role: u.role,
      plan: u.plan || 'basic',
      isPaid: u.isPaid || false,
      createdAt: u.createdAt ? new Date(u.createdAt).toLocaleDateString('ko-KR') : 'N/A',
      lastActivity: u.lastActivityAt ? new Date(u.lastActivityAt).toLocaleDateString('ko-KR') : 'N/A',
      pdfCount: u.pdfCount
    })),
    visitLogs: visitLogs.map(v => ({
      timestamp: v.timestamp ? new Date(v.timestamp).toLocaleString('ko-KR') : 'N/A',
      username: v.username,
      email: v.email,
      ip: v.ip,
      userAgent: v.userAgent || 'Unknown'
    })),
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: Math.ceil(totalCount / pagination.pageSize),
      totalCount
    }
  };
}

// 헬퍼 함수들

function generateDateLabels(from, to, interval) {
  const labels = [];
  const current = new Date(from);
  const end = new Date(to);

  while (current <= end) {
    labels.push(current.toISOString().split('T')[0]);

    if (interval === 'day') {
      current.setDate(current.getDate() + 1);
    } else if (interval === 'week') {
      current.setDate(current.getDate() + 7);
    } else if (interval === 'month') {
      current.setMonth(current.getMonth() + 1);
    }
  }

  return labels;
}

function mapTimeseriesData(labels, data, field) {
  return labels.map(label => {
    const found = data.find(item => item._id === label);
    return found ? (found[field] || 0) : 0;
  });
}

module.exports = {
  aggregateStats,
  aggregateTimeseries,
  aggregateTables
};

