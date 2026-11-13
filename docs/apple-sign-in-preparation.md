# 웹 Apple 로그인 준비

현재 운영 서버는 카카오 로그인만 지원한다. 웹 버튼은 `/auth/session`이 `appleLoginEnabled: true`를 명시한 경우에만 노출하며 현재는 노출되지 않는다. 버튼을 넣은 것만으로 Apple 로그인이 동작한다고 안내하지 않는다.

## 계정·서버 준비

- Apple Developer에서 iOS Primary App ID에 연결된 웹 Services ID 등록. iOS·웹 사용자가 같은 Apple subject로 연결되도록 그룹 확인.
- 웹 도메인 `majung.cloud`와 HTTPS return URL 등록. 등록 예시 `/api/v1/auth/callback/apple`.
- `/api/v1/auth/apple/login`에서 서버가 state·nonce를 발급하고 Apple authorize로 이동. 임의 redirect/return URL 허용 금지.
- callback의 state 일회 사용, 인증 코드 교환, Apple JWKS 서명·issuer·웹 Services ID audience·nonce·만료 확인 후 세션 생성. Apple의 form_post는 SameSite 쿠키 제한을 고려해 서버 측 일회용 state 저장으로 검증. 이 경로에 필요한 범위만 CSRF 예외 적용.
- 이메일·닉네임으로 기존 카카오 계정 자동 병합 금지. Apple subject로 조회·생성. 계정 탈퇴의 Apple 토큰 해제·재시도도 구현 후 활성화.
- iOS·웹 Bundle ID/Services ID 서로 다른 audience 검증, 같은 Apple 계정 재로그인·동시 가입 테스트.
- 서버 준비가 완료된 경우에만 session 응답의 appleLoginEnabled 활성화. 설정이 빠지거나 서버가 준비되지 않으면 기본 미노출.

세부 iOS 교환 형식과 준비 상태는 [iOS 출시 준비](https://github.com/majung-team/majung-ios/blob/main/docs/app-store/README.md) 참고.

## 앱 출시 전 안내

iOS 초대·차량 연결에서 앱 미출시 안내를 먼저 표시하고 테스트 앱 전용 링크는 접힌 영역에 제공한다. 웹 참여·연결을 기본 경로로 유지하며 자동 앱 실행이나 미설치 사용자에게 반복 팝업을 띄우지 않는다.

서버 구현 추적: [majung-backend #79](https://github.com/majung-team/majung-backend/issues/79). 실제 Apple 로그인·탈퇴 검증 전 기능 활성화 금지.
