// Supabase 연결 정보 — 값이 비어 있으면 서버 기능(카운터·소리 저장)은 자동으로 꺼진 채 동작한다.
// anon key는 공개되어도 되는 키(브라우저용). service_role 키는 절대 여기 넣지 말 것.
window.SUBAK_CONFIG = {
  SUPABASE_URL: '',        // 예: https://xxxxxxxx.supabase.co
  SUPABASE_ANON_KEY: '',   // Settings > API > anon public
};
