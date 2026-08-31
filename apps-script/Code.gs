/**
 * 구글폼 응답을 GitHub 저장소의 data/responses.json에 자동으로 커밋하는 Apps Script.
 *
 * 설치 방법:
 *   1. 이 스크립트를 구글폼에 바인딩된 Apps Script 프로젝트에 붙여넣는다.
 *   2. 프로젝트 설정 > 스크립트 속성에 다음 값을 등록한다.
 *        GITHUB_TOKEN     - repo contents 읽기/쓰기 권한을 가진 Personal Access Token
 *        GITHUB_OWNER     - 저장소 소유자(사용자명 또는 조직명)
 *        GITHUB_REPO      - 저장소 이름
 *        GITHUB_BRANCH    - (선택) 커밋할 브랜치. 기본값 main
 *        GITHUB_FILE_PATH - (선택) 데이터 파일 경로. 기본값 data/responses.json
 *   3. 편집기에서 createFormSubmitTrigger 함수를 한 번 수동 실행하고 권한을 승인한다.
 *   4. 연동만 먼저 확인하고 싶다면 manualTest 함수를 수동 실행한다.
 */

var DEFAULT_BRANCH = 'main';
var DEFAULT_FILE_PATH = 'data/responses.json';

/**
 * 폼 제출 트리거 핸들러. 응답을 {질문: 답변} 형태로 정리해 GitHub에 커밋한다.
 */
function onFormSubmit(e) {
  var entry = buildEntryFromResponse(e.response);
  updateGithubFile(entry);
}

/**
 * FormResponse를 {timestamp, answers: {질문: 답변}} 형태의 일반 객체로 변환한다.
 */
function buildEntryFromResponse(formResponse) {
  var answers = {};
  var itemResponses = formResponse.getItemResponses();

  for (var i = 0; i < itemResponses.length; i++) {
    var itemResponse = itemResponses[i];
    answers[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
  }

  return {
    timestamp: formResponse.getTimestamp().toISOString(),
    answers: answers
  };
}

/**
 * GitHub Contents API로 기존 responses.json을 읽어 새 항목을 추가하고 다시 커밋한다.
 * 파일이 아직 없으면(첫 실행) 새로 생성한다.
 */
function updateGithubFile(newEntry) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GITHUB_TOKEN');
  var owner = props.getProperty('GITHUB_OWNER');
  var repo = props.getProperty('GITHUB_REPO');
  var branch = props.getProperty('GITHUB_BRANCH') || DEFAULT_BRANCH;
  var filePath = props.getProperty('GITHUB_FILE_PATH') || DEFAULT_FILE_PATH;

  if (!token || !owner || !repo) {
    throw new Error('스크립트 속성에 GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO를 먼저 설정하세요.');
  }

  var apiUrl = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + filePath;
  var headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json'
  };

  var responses = [];
  var sha = null;

  var getResponse = UrlFetchApp.fetch(apiUrl + '?ref=' + branch, {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true
  });

  if (getResponse.getResponseCode() === 200) {
    var fileData = JSON.parse(getResponse.getContentText());
    sha = fileData.sha;
    var decodedBytes = Utilities.base64Decode(fileData.content.replace(/\n/g, ''));
    var decodedText = Utilities.newBlob(decodedBytes).getDataAsString('UTF-8');
    responses = JSON.parse(decodedText);
  } else if (getResponse.getResponseCode() !== 404) {
    throw new Error('GitHub 파일 조회 실패 (' + getResponse.getResponseCode() + '): ' + getResponse.getContentText());
  }

  responses.push(newEntry);

  var updatedContent = JSON.stringify(responses, null, 2);
  var encodedContent = Utilities.base64Encode(Utilities.newBlob(updatedContent, 'application/json').getBytes());

  var putPayload = {
    message: '설문 응답 추가 (' + newEntry.timestamp + ')',
    content: encodedContent,
    branch: branch
  };
  if (sha) {
    putPayload.sha = sha;
  }

  var putResponse = UrlFetchApp.fetch(apiUrl, {
    method: 'put',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(putPayload),
    muteHttpExceptions: true
  });

  var putCode = putResponse.getResponseCode();
  if (putCode !== 200 && putCode !== 201) {
    throw new Error('GitHub 파일 커밋 실패 (' + putCode + '): ' + putResponse.getContentText());
  }

  Logger.log('GitHub 커밋 성공: ' + putResponse.getResponseCode());
}

/**
 * 폼 제출 트리거를 최초 1회 등록하는 설치용 함수. 편집기에서 수동 실행한다.
 */
function createFormSubmitTrigger() {
  var form = FormApp.getActiveForm();

  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onFormSubmit') {
      Logger.log('onFormSubmit 트리거가 이미 등록되어 있습니다.');
      return;
    }
  }

  ScriptApp.newTrigger('onFormSubmit')
    .forForm(form)
    .onFormSubmit()
    .create();

  Logger.log('onFormSubmit 트리거 등록 완료.');
}

/**
 * 트리거 없이 더미 데이터로 GitHub 연동만 즉시 테스트하는 함수.
 */
function manualTest() {
  var dummyEntry = {
    timestamp: new Date().toISOString(),
    answers: {
      '테스트 질문': '테스트 답변 (manualTest에서 생성됨)'
    }
  };

  updateGithubFile(dummyEntry);
}
