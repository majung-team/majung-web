
# 웹 테스트 및 GitHub Actions 배포

마중 웹은 GitHub Actions를 통해 테스트와 JavaScript 구문 검사를 수행한 뒤, 검증한 정적 파일을 GCP 운영 서버에 배포한다.

웹은 정적 파일 교체 방식으로 배포하며, 백엔드의 블루·그린 배포와는 별도로 관리한다.

## 1. CI/CD 구성

| 항목 | 설정 |
| --- | --- |
| 실행 환경 | Node.js 24 |
| 의존성 설치 | `npm ci` |
| 자동 테스트 | `npm test` |
| 추가 검사 | JavaScript 구문 검사 |
| PR | 코드 검사만 실행 |
| main push | 검사 성공 시 자동 배포 |
| 배포 활성화 | `MAJUNG_DEPLOY_ENABLED=true` |
| GCP 인증 | OIDC · Workload Identity Federation |
| 서버 접속 | IAP SSH |
| 배포 검증 | 공개 HTTPS · `release.json` |
| 실패 복구 | 이전 웹 디렉터리 복원 |

`main`의 수동 워크플로 실행으로 최초 배포를 확인한 뒤 저장소 변수를 통해 자동 배포를 활성화했다.

PR에서는 GCP 인증이나 운영 서버 배포를 수행하지 않는다.

## 2. 배포 흐름

```text
PR / main push
      │
      ▼
npm ci → npm test → JavaScript 구문 검사
      │
      ▼
검증한 정적 파일 압축
      │
      ▼
GCP OIDC 임시 인증
      │
      ▼
IAP SSH로 운영 서버 전송
      │
      ▼
majung-deploy 파일 검증 및 교체
      │
      ▼
공개 HTTPS · release.json 확인
      │
      ├── 성공 → 배포 완료
      └── 실패 → 이전 웹 디렉터리 복원
```

배포에는 검증한 HTML·CSS·JavaScript 등 허용된 정적 파일만 포함한다. 문서, 시험 사진, 환경 파일, Git 데이터는 제외한다.

실패한 배포 작업만 재실행할 경우 기존에 검증한 빌드 아티팩트를 재사용한다. 단, GitHub Actions의 아티팩트 보관 기간 내에서 가능하다.

## 3. 인증 및 보안

GitHub Actions는 OIDC 기반 임시 GCP 권한을 이용하며, 장기 서비스 계정 키를 사용하지 않는다.

- 배포용 GCP·SSH 설정은 GitHub Actions Secrets로 관리한다.
- 카카오 인증 비밀 키와 DB 비밀번호는 웹 저장소나 Actions에 저장하지 않는다.
- 서버의 root 소유 `majung-deploy`가 파일 형식, 체크섬, 허용 목록, 인스턴스 및 호출 계정을 확인한다.
- 루트 도메인, TLS 인증서, Caddy 보안 설정과 SSH 호스트 키는 웹 CI에서 변경하지 않는다.

새 웹 파일을 추가하면 서버의 배포 허용 목록을 먼저 갱신해야 한다.

공통 서버 설정과 Secret 이름은 [백엔드 Actions 배포 문서](https://github.com/majung-team/majung-backend/blob/main/docs/github-actions.md)를 참고한다.

## 4. 배포 확인 및 복구

운영 배포 후 다음 주소에서 배포된 커밋 SHA를 확인한다.

```text
https://majung.cloud/release.json
```

`release.json`의 SHA가 배포 대상 `main` 커밋과 일치해야 한다.

주요 웹 파일의 HTTP 응답도 함께 확인한다.

배포 검증에 실패하면 이전 웹 디렉터리를 복원한다. 이 복구는 웹 정적 파일만 대상으로 하며 백엔드 코드나 DB 변경을 되돌리지 않는다.

## 5. 백엔드 블루·그린 배포와의 관계

백엔드는 동일한 GCP VM에서 두 슬롯을 사용한다.

| 슬롯 | 포트 |
| --- | --- |
| Blue | `8081` |
| Green | `8082` |

Caddy는 다음 설정 파일을 통해 활성 백엔드에 연결한다.

```text
/etc/caddy/majung-upstream.caddy
```

`deploy/Caddyfile`에서 해당 파일을 가져온다.

최초 설치 시 운영자가 `majung-upstream.caddy.example`을 root 소유 설정으로 설치하고 연결 대상을 확인한다. 이후 슬롯 전환은 서버의 root 배포 프로그램이 처리한다.

**웹 Actions는 Caddy upstream을 변경하지 않으며, 백엔드 블루·그린 배포도 웹 정적 파일 배포 방식을 변경하지 않는다.**

공개 `/api/v1/health` 응답의 `slot` 값으로 백엔드 실행 상태를 확인할 수 있다.

- `standalone`: 기존 단일 서버 방식
- `blue`: Blue 슬롯
- `green`: Green 슬롯

자세한 내용은 [블루·그린 배포 문서](https://github.com/majung-team/majung-backend/blob/main/docs/blue-green.md)를 참고한다.

## 6. 운영 배포 검증 · 2026-10-25

[GitHub Actions 수동 실행 #40155585845](https://github.com/majung-team/majung-web/actions/runs/40155585845)에서 최초 웹 운영 배포를 확인했다.

| 검증 항목 | 결과 |
| --- | --- |
| 웹 테스트 및 빌드 검사 | 통과 |
| GCP OIDC 인증 | 성공 |
| IAP SSH 파일 전송 | 성공 |
| 운영 웹 파일 교체 | 성공 |
| 공개 HTTPS 확인 | 성공 |
| `release.json` 커밋 SHA 일치 | 확인 |
| 홈·계정 화면·API 클라이언트 | HTTP 200 |

로컬 웹 테스트, `actionlint`, 셸 구문 검사도 완료했다.

해당 기록은 2026년 10월 25일 최초 배포 결과다. 이후 백엔드 블루·그린 전환과는 구분한다.

실제 휴대전화의 전체 이용 흐름, LTE·Wi-Fi 전환 및 실차 연동은 별도 검증이 필요하다.

## 7. 관련 문서

- [웹 README](../README.md)
- [백엔드 GitHub Actions 배포](https://github.com/majung-team/majung-backend/blob/main/docs/github-actions.md)
- [백엔드 블루·그린 배포](https://github.com/majung-team/majung-backend/blob/main/docs/blue-green.md)
- [개발 현황 및 검증 기록](https://github.com/majung-team/majung/blob/main/docs/development-status.md)
