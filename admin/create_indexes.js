/**
 * MongoDB 인덱스 생성 스크립트
 * 관리자 페이지 v2의 성능 최적화를 위한 인덱스
 * 
 * 사용법:
 *   node admin/create_indexes.js
 * 
 * 주의:
 *   - 기존 서버에 영향을 주지 않습니다
 *   - 중복 인덱스는 자동으로 무시됩니다
 *   - 대용량 데이터베이스에서는 시간이 걸릴 수 있습니다
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zerotyping';

async function createIndexes() {
  console.log('🔗 MongoDB 연결 중...');
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ MongoDB 연결 성공\n');

    const db = client.db();

    // Users 컬렉션 인덱스
    console.log('📊 Users 컬렉션 인덱스 생성...');
    await db.collection('users').createIndex({ createdAt: 1 }, { background: true });
    console.log('  ✓ createdAt');
    await db.collection('users').createIndex({ role: 1 }, { background: true });
    console.log('  ✓ role');
    await db.collection('users').createIndex({ plan: 1 }, { background: true });
    console.log('  ✓ plan');
    await db.collection('users').createIndex({ isPaid: 1 }, { background: true });
    console.log('  ✓ isPaid');
    await db.collection('users').createIndex({ organizationId: 1 }, { background: true });
    console.log('  ✓ organizationId');
    await db.collection('users').createIndex({ email: 1 }, { background: true });
    console.log('  ✓ email');
    await db.collection('users').createIndex({ lastActiveAt: 1 }, { background: true });
    console.log('  ✓ lastActiveAt');

    // Files 컬렉션 인덱스
    console.log('\n📊 Files 컬렉션 인덱스 생성...');
    await db.collection('files').createIndex({ userId: 1, uploadDate: 1 }, { background: true });
    console.log('  ✓ userId + uploadDate (복합)');
    await db.collection('files').createIndex({ uploadDate: 1 }, { background: true });
    console.log('  ✓ uploadDate');

    // Problems 컬렉션 인덱스
    console.log('\n📊 Problems 컬렉션 인덱스 생성...');
    await db.collection('problems').createIndex({ fileId: 1 }, { background: true });
    console.log('  ✓ fileId');
    await db.collection('problems').createIndex({ userId: 1 }, { background: true });
    console.log('  ✓ userId');

    // Subscriptions 컬렉션 인덱스 (존재하는 경우)
    try {
      console.log('\n📊 Subscriptions 컬렉션 인덱스 생성...');
      await db.collection('subscriptions').createIndex({ userId: 1 }, { background: true });
      console.log('  ✓ userId');
      await db.collection('subscriptions').createIndex({ status: 1 }, { background: true });
      console.log('  ✓ status');
      await db.collection('subscriptions').createIndex({ nextBillingAt: 1 }, { background: true });
      console.log('  ✓ nextBillingAt');
      await db.collection('subscriptions').createIndex({ createdAt: 1 }, { background: true });
      console.log('  ✓ createdAt');
    } catch (e) {
      console.log('  ⚠️  Subscriptions 컬렉션이 없거나 인덱스 생성 실패 (무시됨)');
    }

    // Events 컬렉션 인덱스 (존재하는 경우)
    try {
      console.log('\n📊 Events 컬렉션 인덱스 생성...');
      await db.collection('events').createIndex({ userId: 1, createdAt: 1, type: 1 }, { background: true });
      console.log('  ✓ userId + createdAt + type (복합)');
      await db.collection('events').createIndex({ organizationId: 1 }, { background: true });
      console.log('  ✓ organizationId');
      await db.collection('events').createIndex({ type: 1, createdAt: 1 }, { background: true });
      console.log('  ✓ type + createdAt (복합)');
    } catch (e) {
      console.log('  ⚠️  Events 컬렉션이 없거나 인덱스 생성 실패 (무시됨)');
    }

    // Pipeline_runs 컬렉션 인덱스 (존재하는 경우)
    try {
      console.log('\n📊 Pipeline_runs 컬렉션 인덱스 생성...');
      await db.collection('pipeline_runs').createIndex({ createdAt: 1, stage: 1, status: 1 }, { background: true });
      console.log('  ✓ createdAt + stage + status (복합)');
      await db.collection('pipeline_runs').createIndex({ userId: 1 }, { background: true });
      console.log('  ✓ userId');
    } catch (e) {
      console.log('  ⚠️  Pipeline_runs 컬렉션이 없거나 인덱스 생성 실패 (무시됨)');
    }

    // Payments 컬렉션 인덱스 (존재하는 경우)
    try {
      console.log('\n📊 Payments 컬렉션 인덱스 생성...');
      await db.collection('payments').createIndex({ userId: 1, status: 1, createdAt: 1 }, { background: true });
      console.log('  ✓ userId + status + createdAt (복합)');
      await db.collection('payments').createIndex({ status: 1 }, { background: true });
      console.log('  ✓ status');
      await db.collection('payments').createIndex({ createdAt: 1 }, { background: true });
      console.log('  ✓ createdAt');
    } catch (e) {
      console.log('  ⚠️  Payments 컬렉션이 없거나 인덱스 생성 실패 (무시됨)');
    }

    // Visits 컬렉션 인덱스 (존재하는 경우)
    try {
      console.log('\n📊 Visits 컬렉션 인덱스 생성...');
      await db.collection('visits').createIndex({ timestamp: 1 }, { background: true });
      console.log('  ✓ timestamp');
      await db.collection('visits').createIndex({ userId: 1, timestamp: 1 }, { background: true });
      console.log('  ✓ userId + timestamp (복합)');
    } catch (e) {
      console.log('  ⚠️  Visits 컬렉션이 없거나 인덱스 생성 실패 (무시됨)');
    }

    console.log('\n✅ 모든 인덱스 생성 완료!');
    console.log('\n📈 인덱스 목록 확인:');
    console.log('  - Users:', await db.collection('users').indexes());
    console.log('  - Files:', await db.collection('files').indexes());
    console.log('  - Problems:', await db.collection('problems').indexes());

  } catch (error) {
    console.error('❌ 오류 발생:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n🔌 MongoDB 연결 종료');
  }
}

// 스크립트 실행
if (require.main === module) {
  createIndexes()
    .then(() => {
      console.log('\n✨ 완료!');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ 실행 실패:', err);
      process.exit(1);
    });
}

module.exports = { createIndexes };

