# majung-web

운전자와 탑승자가 휴대전화에서 사용하는 마중 웹이다. 별도 앱 설치 없이 로그인·사람 찾기·마중 요청·초대 수락을 하고,
픽업이 시작되면 차량 위치·남은 시간·준비 상태를 확인한다. HTML·CSS·JavaScript로 구성하며 현재 React를 사용하지 않는다.

- 접속: https://majung.cloud/account
- 초대·참여: https://majung.cloud (받은 초대 링크로 접속)
- [전체 사용 안내 Wiki](https://github.com/majung-team/majung/wiki)
- [개발 현황·실제 PR·담당](https://github.com/majung-team/majung/blob/main/docs/development-status.md)

## 로컬 실행

Node.js 22 이상을 사용한다.

```sh
npm ci
npm test
npm start
```

웹은 `127.0.0.1:4173`, API는 `127.0.0.1:8080`을 사용한다. 로컬 백엔드도 실행해야 로그인·조회가 동작한다.
`MAJUNG_WEB_PORT`·`MAJUNG_API_PORT`로 로컬 포트를 바꿀 수 있다.
운영에서는 Caddy가 웹을 제공하고 `/api/`를 백엔드로 전달한다.

## 화면·동작

| 문서 | 내용 |
| --- | --- |
| [서비스 화면](docs/service-screens.md) | 픽업·사람 찾기·내 정보 |
| [지도](docs/passenger-map.md) | 차량·만날 장소 마커. 내비 경로 원본을 웹이 계산하지 않음 |
| [장소 제안](docs/place-proposal.md) | 장소명·주소 검색, 지도 지점 선택, 운전자 제안 |
| [사람 찾기](docs/account-connections.md) | 카카오 로그인·닉네임·마중 ID·사람 연결 |
| [초대 참여](docs/auto-connect.md) | 링크로 들어온 탑승자의 자동 참여 |
| [최신성](docs/vehicle-freshness.md) | 오래되거나 끊긴 위치·ETA 표시 구분 |
| [도착 알림](docs/arrival-push.md) | 브라우저 구독과 알림 조건 |
| [차량 해제 버튼](docs/vehicle-detach-layout.md) | 내 차량 정보·연결 해제 배치 |
| [Actions 배포](docs/github-actions.md) | 테스트와 정적 파일 배포 |

연결 이력이 없는 탑승자도 운전자를 검색해 장소와 함께 요청할 수 있다.
초대 링크 자동 참여와 계정 요청 수락은 서로 다른 흐름이다.
SSE는 변경 신호를 전달하고 API로 상태를 다시 읽는다. 연결이 끊기거나 유효 시간이 지나면 이전 위치·ETA를 현재 값처럼 표시하지 않는다.

웹 테스트와 브라우저 시험은 실제 휴대전화 GPS·푸시 배너·LTE 전환 검증과 구분한다.
백엔드 배포 재시작 때는 연결이 끊기거나 재로그인이 필요할 수 있다.
[현재 개발 기준](docs/revised-plan.md) · [기여 규칙](CONTRIBUTING.md)
