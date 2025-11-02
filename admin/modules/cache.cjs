/**
 * 관리자 페이지 v2 - 캐시 관리
 * 단순 인메모리 캐시 (TTL: 60초)
 */

class AdminCache {
  constructor(ttl = 60000) { // 기본 60초
    this.cache = new Map();
    this.ttl = ttl;
  }

  /**
   * 캐시에서 값 가져오기
   * @param {string} key - 캐시 키
   * @returns {any|null} - 캐시된 값 또는 null
   */
  get(key) {
    const item = this.cache.get(key);

    if (!item) {
      return null;
    }

    // TTL 체크
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  /**
   * 캐시에 값 저장
   * @param {string} key - 캐시 키
   * @param {any} value - 저장할 값
   * @param {number} customTTL - 커스텀 TTL (밀리초, 선택사항)
   */
  set(key, value, customTTL = null) {
    const ttl = customTTL || this.ttl;
    const expiry = Date.now() + ttl;

    this.cache.set(key, {
      value,
      expiry
    });

    // 자동 정리
    this.cleanup();
  }

  /**
   * 캐시에서 값 삭제
   * @param {string} key - 캐시 키
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * 모든 캐시 삭제
   */
  clear() {
    this.cache.clear();
  }

  /**
   * 만료된 항목 정리
   */
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiry) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));

    // 캐시 크기 제한 (최대 1000개)
    if (this.cache.size > 1000) {
      // 가장 오래된 것 삭제 (FIFO)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  /**
   * 캐시 통계
   * @returns {Object} - { size, ttl }
   */
  stats() {
    return {
      size: this.cache.size,
      ttl: this.ttl
    };
  }

  /**
   * Async wrapper for get/set pattern
   * @param {string} key - 캐시 키
   * @param {Function} fetchFn - 데이터를 가져오는 비동기 함수
   * @param {number} customTTL - 커스텀 TTL
   * @returns {Promise<any>} - 캐시되거나 fetch한 값
   */
  async getOrFetch(key, fetchFn, customTTL = null) {
    // 캐시 확인
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    // 캐시 미스 - 데이터 fetch
    const value = await fetchFn();

    // 캐시에 저장
    this.set(key, value, customTTL);

    return value;
  }
}

// 싱글톤 인스턴스
const adminCache = new AdminCache(60000); // 60초 TTL

module.exports = adminCache;

