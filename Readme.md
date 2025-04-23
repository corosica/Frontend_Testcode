# 프론트엔드 성능 관련 테스트 코드 v 0.1

## 목적

단순 '조회'시 렌더링 속도의 측정 및 결과 저장에 관한 코드셋 입니다.

## 실행방법

pnpm package manager를 사용합니다.

```
git clone "Repo이름"
pnpm install
# 기본 환경 설정
```

```
pnpm exec tsc

# ts 를 js로 컴파일하는 코드입니다. ts로 바로 실행시(ts-node 사용 등) 필요 없습니다.
# 기본적으로 dist 폴더에 js코드가 생성됩니다. \
```

```
node dist/test-load.js
# 테스트를 시작하는 코드입니다. js인 경우만 실행 가능합니다.
```

테스트가 끝난 파일은 perf-test-{날자}.json 파일로 저장됩니다.
