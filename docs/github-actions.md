# 웹 테스트와 배포

PR·main에서 Node.js 24의 `npm ci`, `npm test`, JavaScript 구문 검사를 실행한다. 배포에는 검사한 HTML·CSS·JS만 압축해 사용한다. 문서·사진·환경 파일·Git 데이터는 웹 서버에 보내지 않는다.

main의 수동 워크플로 실행으로 첫 배포를 확인한 뒤 저장소 변수 `MAJUNG_DEPLOY_ENABLED=true`로 자동 배포를 켠다. false일 때 main push에서는 CI만 실행한다. PR에서는 GCP 인증·배포를 실행하지 않는다.

GCP OIDC·SSH 배포 설정은 저장소 Secrets에 보관한다. 앱 카카오 키·DB 비밀번호는 이 저장소나 Actions에 등록하지 않는다. 서버에 미리 설치한 root 소유 `majung-deploy`가 웹 파일 형식·체크섬·인스턴스·호출 계정을 확인한다. 새 웹 파일은 공개 HTTPS의 release.json에서 커밋 SHA를 확인하고, 실패하면 이전 웹 폴더를 복원한다.

공통 서버 설치와 Secret 이름은 [서버의 Actions 배포 문서](https://github.com/majung-team/majung-backend/blob/ci/6-server-deployment/docs/github-actions.md)에 정리했다. 루트 도메인·Caddy 인증서·비공개 정책·SSH 호스트 키는 CI에서 바꾸지 않는다.

로컬 웹 테스트·actionlint·셸 구문 검사는 완료했다. 실제 GitHub OIDC 및 Actions 배포 실행은 워크플로 병합 후 확인한다. 블루·그린 방식은 아직 사용하지 않는다.
