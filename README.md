# 구글폼 → GitHub 응답 타임라인

구글폼에 설문 응답이 제출되면 Apps Script가 GitHub 저장소의 `data/responses.json`에 자동으로 커밋하고,
GitHub Pages로 배포된 `site/index.html`이 그 데이터를 최신순 타임라인으로 보여줍니다.
서버(백엔드)는 따로 필요하지 않습니다.

```
[구글폼 제출] → Apps Script(onFormSubmit) → GitHub Contents API 커밋 → GitHub Pages가 fetch로 표시
```

## 폴더 구조

```
├── apps-script/
│   └── Code.gs           # 구글폼에 바인딩해서 사용하는 Apps Script
├── site/
│   ├── index.html         # GitHub Pages로 배포되는 응답 목록 페이지
│   └── data/
│       └── responses.json # Apps Script가 커밋으로 갱신하는 데이터 파일
└── README.md
```

## 설정 순서

### 1. GitHub 저장소 준비

1. GitHub에 새 저장소를 만들고 이 폴더의 내용을 푸시합니다.
2. 저장소 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다.
   (브랜치/폴더를 직접 고르는 방식이 아니라, 이 저장소에 포함된 `.github/workflows/pages.yml`이 `site/` 폴더 내용만 자동으로 배포합니다.)
3. `main`에 푸시되면(특히 `site/` 하위 변경) Actions 탭에서 `Deploy site/ to GitHub Pages` 워크플로가 실행되는지 확인합니다.
4. 배포가 끝나면 `https://ysiwoo.github.io/opinion/` 주소로 `index.html`이 열리는지 확인합니다.

### 2. GitHub Personal Access Token 발급

- 이 저장소에 대해서만 **Contents: Read and write** 권한을 가진 Fine-grained Personal Access Token을 발급합니다.
- 발급된 토큰 값은 안전하게 보관하고, 다음 단계에서 Apps Script 스크립트 속성에만 등록합니다. 코드에 직접 넣지 마세요.

### 3. 구글폼에 Apps Script 바인딩

1. 대상 구글폼을 엽니다 → 메뉴(⋮) → **부가기능(확장 프로그램) → Apps Script**.
2. 열린 프로젝트에 `apps-script/Code.gs`의 내용을 그대로 붙여넣습니다.
3. 왼쪽 **프로젝트 설정(톱니바퀴) → 스크립트 속성**에서 아래 값을 등록합니다.

   | 속성 이름 | 설명 | 예시 |
   |---|---|---|
   | `GITHUB_TOKEN` | 1단계에서 발급한 토큰 | `github_pat_...` |
   | `GITHUB_OWNER` | 저장소 소유자 | `ysiwoo` |
   | `GITHUB_REPO` | 저장소 이름 | `opinion` |
   | `GITHUB_BRANCH` | (선택) 커밋할 브랜치, 기본 `main` | `main` |
   | `GITHUB_FILE_PATH` | (선택) 데이터 파일 경로, 기본 `data/responses.json` | `site/data/responses.json` |
   | `GEMINI_API_KEY` | (선택) Gemini API 키. 등록하면 응답마다 주제/감정/비속어 자동 분류가 추가됨 | `AIza...` |
   | `ADMIN_PASSWORD` | (선택) 사이트 "관리자 모드"(의견 숨기기/복원) 비밀번호 | `임의의 문자열` |
   | `GITHUB_HIDDEN_FILE_PATH` | (선택) 숨김 의견함 파일 경로, 기본 `data/hidden.json` | `site/data/hidden.json` |

   > `GITHUB_FILE_PATH`는 실제 저장소에서 `responses.json`이 위치한 경로와 정확히 일치해야 합니다.
   > (예: 저장소 루트에 `site/`를 그대로 뒀다면 `site/data/responses.json`, `site/` 내용을 루트로 옮겼다면 `data/responses.json`.)

### 4. 트리거 등록

1. Apps Script 편집기 상단 함수 선택 드롭다운에서 `createFormSubmitTrigger`를 선택하고 **실행**합니다.
2. 최초 실행 시 권한 승인 화면이 뜨면 승인합니다.
3. **트리거(시계 아이콘)** 메뉴에서 `onFormSubmit` 트리거가 등록되었는지 확인합니다.

### 5. 연동 테스트

- 트리거 없이 GitHub 연동만 먼저 확인하려면 함수 선택에서 `manualTest`를 선택해 실행합니다.
  실행 후 저장소의 `responses.json`에 더미 항목이 커밋되었는지 확인하세요.
- 실제 폼을 열어 테스트 응답을 제출한 뒤:
  1. GitHub 저장소에 새 커밋이 생겼는지 확인합니다.
  2. GitHub Pages 사이트를 새로고침해 방금 제출한 응답이 타임라인 맨 위에 나타나는지 확인합니다.

## 참고

- `site/index.html`은 `responses.json`의 키(질문)를 그대로 순회해서 표시하므로, 폼 문항이 추가/변경되어도
  이 파일을 수정할 필요가 없습니다.
- `fetch`가 실패하는 환경(예: 로컬에서 `index.html`을 파일로 직접 열었을 때)에서는 코드 내 `SAMPLE_DATA`가 대신 표시됩니다.

## Gemini를 이용한 응답 자동 분류 (선택 기능)

`GEMINI_API_KEY` 스크립트 속성을 등록하면, 폼이 제출될 때마다 Apps Script가 Gemini API(`gemini-3.6-flash`)를 호출해
응답 내용을 분석하고 각 항목에 `classification` 필드를 추가해 커밋합니다.

```json
{
  "timestamp": "2026-09-01T12:00:00.000Z",
  "answers": { "의견": "..." },
  "classification": {
    "topic": "성능",
    "sentiment": "negative",
    "hasProfanity": true,
    "profanityNote": "비속어 표현 포함"
  }
}
```

- `topic`: 정해진 목록 없이 Gemini가 내용에 맞게 붙이는 짧은 주제 라벨
- `sentiment`: `positive` / `negative` / `neutral`
- `hasProfanity`: 비속어·욕설·혐오 표현 포함 여부. `true`인 항목은 타임라인에서 주황 테두리와 경고 배지로 표시됩니다.
- `GEMINI_API_KEY`를 등록하지 않았거나 API 호출이 실패해도 분류만 생략될 뿐, 응답 저장(GitHub 커밋) 자체는 항상 정상 동작합니다.
- 분류 로직만 따로 테스트하려면 Apps Script 편집기에서 `manualClassifyTest` 함수를 실행하고 로그를 확인하세요.
- API 키는 [Google AI Studio](https://aistudio.google.com/app/apikey)에서 무료로 발급받을 수 있습니다.

## 의견 숨기기 (관리자 전용, 선택 기능)

사이트에서 "관리자 모드"로 로그인하면 각 의견 옆에 **숨기기** 버튼이 나타납니다. 숨긴 의견은 `data/responses.json`에서
`data/hidden.json`(숨김 의견함)으로 옮겨지고, 관리자 모드에서 **복원** 버튼으로 언제든 되돌릴 수 있습니다.
복원하지 않고 **10일이 지나면 자동으로 완전히 삭제**됩니다.

> 이 저장소가 공개(public) 저장소라면 `data/hidden.json` 원본 파일 자체는 GitHub에서 여전히 열람 가능합니다.
> "숨기기"는 사이트 화면에서 보이지 않게 하는 기능이며, 10일이 지나 삭제되기 전까지는 완전한 비공개가 아닙니다.

### 설정 방법

1. Apps Script 스크립트 속성에 `ADMIN_PASSWORD`를 등록합니다 (원하는 비밀번호 문자열).
2. Apps Script 편집기 상단 **배포 → 새 배포**를 클릭합니다.
   - 유형: **웹 앱**
   - 실행 사용자: **나**
   - 액세스 권한: **모든 사용자**
3. 배포 후 발급되는 `https://script.google.com/macros/s/.../exec` 형태의 URL을 복사합니다.
4. `site/index.html`에서 `var HIDE_API_URL = "";` 줄을 찾아 그 URL을 넣습니다.
   ```js
   var HIDE_API_URL = "https://script.google.com/macros/s/.../exec";
   ```
5. Apps Script 편집기에서 `createPurgeTrigger` 함수를 한 번 수동 실행합니다.
   (숨김 의견함에서 10일 지난 항목을 매일 자동으로 삭제하는 트리거가 등록됩니다.)
6. 변경사항을 커밋/푸시해 사이트를 다시 배포합니다.

> **주의:** Apps Script 코드를 수정한 뒤에는 저장만으로는 웹 앱 URL에 반영되지 않습니다.
> **배포 → 배포 관리**에서 기존 배포를 **새 버전**으로 다시 배포해야 합니다.

### 사용 방법

- 사이트 오른쪽 위 **관리자 모드** 버튼을 눌러 비밀번호를 입력하면, 각 의견에 **숨기기** 버튼과
  숨김 의견함 패널(남은 삭제일 표시, 복원 버튼)이 나타납니다.
- `ADMIN_PASSWORD`를 등록하지 않았거나 `HIDE_API_URL`을 설정하지 않으면 이 기능은 비활성화된 채로
  사이트의 나머지 기능(타임라인 표시, 자동 분류)은 그대로 동작합니다.
