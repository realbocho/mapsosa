# 맵소사

동네 청과점 상품을 모아 주문받고, 계좌이체·환불·수요일/토요일 픽업을 중개하는 서비스입니다.

## 로컬 실행

1. Node.js 20 이상을 설치하고 저장소를 내려받습니다.
2. `.env.example`을 `.env.local`로 복사한 뒤 Supabase URL과 publishable/anon key를 입력합니다.
3. `npm install` 후 `npm run dev`를 실행합니다.
4. `supabase/migrations`의 SQL 파일을 파일명 순서대로 Supabase SQL Editor에서 실행합니다. 이미 `202610080004_orders_without_round.sql`까지 실행했다면 새 기능을 위해 `202610080005_customer_orders_and_pickup.sql`만 추가로 실행합니다.

Supabase 설정 전에는 상품이 표시되지 않습니다. 상품은 `/admin`에서 운영자가 등록하며, 고객 모바일 화면에는 활성 상품이 한 목록으로 표시됩니다. OAuth 로그인과 주문 저장은 Supabase 프로젝트 설정이 필요합니다. 주문은 고객이 고른 수요일/토요일 픽업 날짜를 저장하며, 별도의 픽업 회차 개설은 요구하지 않습니다.

## 카카오 로그인

Kakao Developers에서 Kakao Login과 OpenID Connect를 활성화하고, Redirect URI로 `{서비스 도메인}/auth/kakao/callback`을 등록합니다. 이 앱은 `openid`만 요청해 닉네임, 프로필 사진, 이메일을 요청하지 않습니다. Supabase Dashboard의 **Authentication → Providers → Kakao**에는 REST API key와 Client Secret을 등록하고, 이메일 없이 가입 허용을 켭니다. Vercel 환경 변수에는 `KAKAO_REST_API_KEY`와 서버 전용 `KAKAO_CLIENT_SECRET`을 추가합니다. Supabase Auth URL Configuration에는 로컬 URL과 배포 도메인을 Redirect URL로 등록합니다.

## Kakao 지도

Kakao Developers 앱의 **앱 설정 → 앱 → 플랫폼 키 → JavaScript 키**를 사용하고, JavaScript SDK 도메인에 `https://mapsosa-three.vercel.app`과 로컬 개발 주소를 등록합니다. 해당 키를 `NEXT_PUBLIC_KAKAO_MAP_KEY`로 설정합니다. REST API 키가 아니라 JavaScript 키를 사용해야 합니다. 지도는 등록된 가게 주소를 좌표로 변환해 마커로 표시합니다.

## 배포

GitHub 저장소를 Vercel 프로젝트에 연결하면 기본 Next.js 빌드 설정으로 배포됩니다. Vercel 프로젝트에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_KAKAO_MAP_KEY`, `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET` 환경 변수를 Preview/Production별로 추가하세요. Kakao client secret과 Supabase service-role key는 브라우저 환경 변수로 공개하지 마세요.

## 관리자 운영

1. Kakao 로그인으로 한 번 가입한 뒤 Supabase의 `profiles` 테이블에서 해당 계정의 `role`을 `operator`로 변경합니다. 예: `update public.profiles set role = 'operator' where id = '<auth user UUID>';`
2. `/admin`에 접속해 Kakao 로그인하면 관리자 권한을 확인합니다.
3. `/admin`의 **주문·입금**에서 수요일/토요일 픽업일을 선택해 상품별 주문 수량과 입금 확인/대기 현황을 봅니다. 주문별 입금 확인, 확정 수량 입력, 부분/전액 환불, 확인서 발급과 환불 이체 기록을 처리할 수 있습니다.
4. 같은 탭에서 고객 입금 계좌, 청과점 예약금·판매대금·회수 내역도 관리합니다. 고객은 주문 직후 `/orders`에서 본인 주문, 남은 입금 시간, 취소·환불 상태와 픽업 확인서를 확인합니다.
5. **가게·상품**에서 청과점의 이름, 동네, 주소, 연락처, 오픈/마감 시간, 정기 휴무를 등록합니다. 상품은 슬롯형/즉시구매형으로 선택하고 슬롯 수는 선택 입력입니다.
6. 관리자 링크는 모바일 헤더에 표시되며, 관리 기능은 `operator` 권한과 RLS로 제한됩니다. 관리자 비밀번호나 서비스 키를 코드에 저장하지 않습니다.

## MVP 구현 범위와 다음 단계

- 구현: 모바일 중심 고객 화면, 수/토 실제 픽업 날짜 자동 표시, 가격 비교, 장바구니, Kakao OAuth, 본인 주문 조회·취소/환불 요청·픽업 완료, 입금 계좌 안내, 관리자 날짜별 주문 집계와 입금 확인, 슬롯 배수 권장 수량 계산과 경계 주문 재배정, 주문 확정/환불, QR 픽업 확인서, 청과점 이체 기록, 관리자 상품·가게 등록/수정, RLS.
- 남은 연동: 청과점 체크리스트 SMS 자동 발송에는 SMS 사업자 계정과 인증정보가 필요합니다. 현재 관리자가 가게 확인 수량과 실제 입금 여부를 직접 입력합니다. 슬롯 배수 확정은 전날 11시 이후 관리자 화면의 계산 버튼을 실행하는 방식입니다.

새 DB 기능을 적용하려면 Supabase Dashboard → SQL Editor에서 `202610080005_customer_orders_and_pickup.sql` 내용을 실행하고, 관리자 화면의 주문·입금 탭에서 실제 입금 계좌를 저장해야 주문 접수가 열립니다. 미입금 취소와 픽업 자동 완료에는 Supabase Cron이 사용됩니다.
