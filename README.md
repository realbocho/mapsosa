# 맵소사

동네 청과점 상품을 모아 주문받고, 계좌이체·환불·수요일/토요일 픽업을 중개하는 서비스입니다.

## 로컬 실행

1. Node.js 20 이상을 설치하고 저장소를 내려받습니다.
2. `.env.example`을 `.env.local`로 복사한 뒤 Supabase URL과 publishable/anon key를 입력합니다.
3. `npm install` 후 `npm run dev`를 실행합니다.
4. `supabase/migrations`의 SQL 파일을 파일명 순서대로 Supabase SQL Editor에서 실행합니다.

Supabase 설정 전에는 상품이 표시되지 않습니다. 상품은 `/admin`에서 운영자가 등록하며, 고객 모바일 화면에는 활성 상품이 한 목록으로 표시됩니다. OAuth 로그인과 주문 저장은 Supabase 프로젝트 설정이 필요합니다.

## 카카오 로그인

Kakao Developers에서 Kakao Login과 OpenID Connect를 활성화하고, Redirect URI로 `{서비스 도메인}/auth/kakao/callback`을 등록합니다. 이 앱은 `openid`만 요청해 닉네임, 프로필 사진, 이메일을 요청하지 않습니다. Supabase Dashboard의 **Authentication → Providers → Kakao**에는 REST API key와 Client Secret을 등록하고, 이메일 없이 가입 허용을 켭니다. Vercel 환경 변수에는 `KAKAO_REST_API_KEY`와 서버 전용 `KAKAO_CLIENT_SECRET`을 추가합니다. Supabase Auth URL Configuration에는 로컬 URL과 배포 도메인을 Redirect URL로 등록합니다.

## 배포

GitHub 저장소를 Vercel 프로젝트에 연결하면 기본 Next.js 빌드 설정으로 배포됩니다. Vercel 프로젝트에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET` 환경 변수를 Preview/Production별로 추가하세요. Kakao client secret과 Supabase service-role key는 브라우저 환경 변수로 공개하지 마세요.

## 관리자 상품 등록

1. Kakao 로그인으로 한 번 가입한 뒤 Supabase의 `profiles` 테이블에서 해당 계정의 `role`을 `operator`로 변경합니다. 예: `update public.profiles set role = 'operator' where id = '<auth user UUID>';`
2. `/admin`에 접속해 Kakao 로그인하면 관리자 권한을 확인합니다.
3. 청과점의 이름, 동네, 주소, 연락처, 오픈/마감 시간, 정기 휴무를 등록합니다. 이어 상품명, 규격, 선택 모집 단위, 매입/판매 가격, 재고 수량, 비교 가격, 설명, 이미지 주소를 등록합니다.
4. 관리자 링크는 모바일 헤더에 표시되며, 관리 기능은 `operator` 권한과 RLS로 제한됩니다. 관리자 비밀번호나 서비스 키를 코드에 저장하지 않습니다.

## MVP 구현 범위와 다음 단계

- 구현: 모바일 중심 고객 화면, 수/토 픽업 선택, 단일 상품 목록, 가격 비교, 장바구니, 환불 정보 입력, Kakao OAuth, Supabase 상품 읽기와 주문 생성 RPC, 관리자 상품·청과점 등록/숨김, RLS.
- 다음 구현: 픽업 회차 등록, 입금 확인, 슬롯 배수 확정, 청과점 체크리스트 SMS 발송과 토큰 링크, 주문 내역·상태 조회, 입금 계좌 설정, 전자 픽업증명서 QR. 실제 주문에는 픽업 회차 등록이 필요합니다.

슬롯 확정·환불 이체는 금액과 주문 상태를 변경하는 작업이므로, 운영자 어드민과 슬롯 배수 확정 처리를 추가하고 운영자 권한을 검토한 뒤 실결제 운영을 시작해야 합니다. 미입금 주문 만료는 Supabase Cron을 사용합니다.
