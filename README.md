# 맵소사

동네 청과점 상품을 모아 주문받고, 계좌이체·환불·수요일/토요일 픽업을 중개하는 서비스입니다.

## 로컬 실행

1. Node.js 20 이상을 설치하고 저장소를 내려받습니다.
2. `.env.example`을 `.env.local`로 복사한 뒤 Supabase URL과 publishable/anon key를 입력합니다.
3. `npm install` 후 `npm run dev`를 실행합니다.
4. `supabase/migrations/202610080001_initial_schema.sql`을 Supabase SQL Editor에서 실행합니다.

Supabase 설정 전에도 상품 둘러보기와 장바구니 화면은 데모 데이터로 확인할 수 있습니다. OAuth 로그인과 주문 저장은 Supabase 프로젝트 설정이 필요합니다.

## 카카오 로그인

Supabase Dashboard의 **Authentication → Providers → Kakao**에서 Kakao REST API key와 Client Secret을 등록하고, Kakao Developers 앱에 Supabase Auth callback URL을 허용해야 합니다. Supabase Auth URL Configuration에는 로컬 URL과 배포 도메인을 Redirect URL로 등록합니다. 앱은 `/auth/callback`에서 PKCE code를 세션으로 교환합니다.

## 배포

GitHub 저장소를 Vercel 프로젝트에 연결하면 기본 Next.js 빌드 설정으로 배포됩니다. Vercel 프로젝트에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` 환경 변수를 Preview/Production별로 추가하세요. Kakao client secret과 Supabase service-role key는 Supabase 대시보드에만 보관하고 브라우저 환경 변수로 공개하지 마세요.

## MVP 구현 범위와 다음 단계

- 구현: 제철 상품 탐색, 수/토 픽업 전환, 슬롯형/즉시구매형 표시, 가격 비교 상세, 장바구니, 사전 환불 방식 선택, 환불 계좌/입금자 입력, Kakao OAuth 진입과 콜백, Supabase 상품 읽기, 주문 생성 RPC와 한 시간 미입금 자동 취소 Cron, 관련 스키마/RLS.
- 다음 구현: 운영자 어드민(상품/회차 등록, 입금 확인, 슬롯 배수 확정), 청과점 체크리스트 SMS 발송과 토큰 링크, 주문 내역·상태 조회, 입금 계좌 설정, 실제 상품 이미지, 전자 픽업증명서 QR. 상품과 픽업 회차를 운영자가 DB에 등록해야 실제 주문을 접수할 수 있습니다.

슬롯 확정·환불 이체는 금액과 주문 상태를 변경하는 작업이므로, 운영자 어드민과 슬롯 배수 확정 처리를 추가하고 운영자 권한을 검토한 뒤 실결제 운영을 시작해야 합니다. 미입금 주문 만료는 Supabase Cron을 사용합니다.
