/**
 * 구글폼 응답을 GitHub 저장소의 data/responses.json에 자동으로 커밋하는 Apps Script.
 *
 * 설치 방법:
 *   1. 이 스크립트를 구글폼에 바인딩된 Apps Script 프로젝트에 붙여넣는다.
 *   2. 프로젝트 설정 > 스크립트 속성에 다음 값을 등록한다.
 *        GITHUB_TOKEN         - repo contents 읽기/쓰기 권한을 가진 Personal Access Token
 *        GITHUB_OWNER         - 저장소 소유자(사용자명 또는 조직명)
 *        GITHUB_REPO          - 저장소 이름
 *        GITHUB_BRANCH        - (선택) 커밋할 브랜치. 기본값 main
 *        GITHUB_FILE_PATH     - (선택) 응답 데이터 파일 경로. 기본값 data/responses.json
 *        GITHUB_HIDDEN_FILE_PATH - (선택) 숨김 의견함 파일 경로. 기본값 data/hidden.json
 *        GEMINI_API_KEY       - (선택) Gemini API 키. 등록하면 응답마다 주제/감정/비속어 분류를 추가한다.
 *        ADMIN_PASSWORD       - (선택) 사이트의 "관리자 모드"(의견 숨기기/복원) 비밀번호.
 *                                등록하지 않으면 숨기기 기능이 비활성화된다.
 *   3. 편집기에서 createFormSubmitTrigger 함수를 한 번 수동 실행하고 권한을 승인한다.
 *   4. 연동만 먼저 확인하고 싶다면 manualTest 함수를 수동 실행한다.
 *   5. 분류 로직만 따로 확인하고 싶다면 manualClassifyTest 함수를 수동 실행한다.
 *   6. 숨기기 기능을 쓰려면:
 *      a. 배포 > 새 배포 > 유형: 웹 앱으로 배포한다. (실행 사용자: 나, 액세스 권한: 모든 사용자)
 *      b. 배포로 얻은 /exec URL을 site/index.html의 HIDE_API_URL에 붙여넣는다.
 *      c. createPurgeTrigger 함수를 한 번 수동 실행해서, 숨김 의견함에서 10일 지난 항목을
 *         매일 자동으로 완전히 삭제하는 트리거를 등록한다.
 *      d. 코드를 수정할 때마다 배포 > 배포 관리에서 "새 버전"으로 다시 배포해야
 *         웹 앱 URL에 최신 코드가 반영된다 (그냥 저장만 하면 반영되지 않음).
 */

var DEFAULT_BRANCH = 'main';
var DEFAULT_FILE_PATH = 'data/responses.json';
var DEFAULT_HIDDEN_FILE_PATH = 'data/hidden.json';
var HIDDEN_RETENTION_DAYS = 10;
var GEMINI_MODEL = 'gemini-3.6-flash';

/**
 * 폼 제출 트리거 핸들러. 응답을 {질문: 답변} 형태로 정리하고 Gemini로 분류한 뒤 GitHub에 커밋한다.
 */
function onFormSubmit(e) {
  var entry = buildEntryFromResponse(e.response);

  var classification = classifyEntry(entry);
  if (classification) {
    entry.classification = classification;
  }

  updateGithubFile(entry);
}

/**
 * Gemini API로 응답 내용을 주제 / 감정(긍정·부정·중립) / 비속어 포함 여부로 분류한다.
 * GEMINI_API_KEY가 없거나 요청이 실패해도 예외를 던지지 않고 null을 반환해서,
 * 분류 실패가 GitHub 커밋(핵심 기능)까지 막지 않게 한다.
 */
function classifyEntry(entry) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return null;
  }

  var answerText = Object.keys(entry.answers).map(function (question) {
    var value = entry.answers[question];
    return question + ': ' + (Array.isArray(value) ? value.join(', ') : value);
  }).join('\n');

  var responseSchema = {
    type: 'OBJECT',
    properties: {
      topic: {
        type: 'STRING',
        description: '응답 내용을 대표하는 짧은 주제 라벨(1~4단어). 정해진 목록은 없으며 내용에 맞게 자유롭게 정한다. 예: UI/디자인, 성능, 요금, 고객지원, 기능 제안, 기타'
      },
      sentiment: {
        type: 'STRING',
        enum: ['positive', 'negative', 'neutral'],
        description: '응답 전반의 감정 톤'
      },
      has_profanity: {
        type: 'BOOLEAN',
        description: '비속어, 욕설, 혐오 표현 포함 여부'
      },
      profanity_note: {
        type: 'STRING',
        description: 'has_profanity가 true일 때 어떤 표현이 문제인지 짧게 설명. false면 빈 문자열.'
      }
    },
    required: ['topic', 'sentiment', 'has_profanity', 'profanity_note']
  };

  var payload = {
    systemInstruction: {
      parts: [{ text: '너는 설문 응답을 분류하는 어시스턴트다. 주어진 질문/답변 내용을 보고 정해진 스키마에 맞춰서만 응답해라.' }]
    },
    contents: [
      { parts: [{ text: answerText }] }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema
    }
  };

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-goog-api-key': apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('Gemini 분류 요청 실패 (' + response.getResponseCode() + '): ' + response.getContentText());
    return null;
  }

  var body = JSON.parse(response.getContentText());
  var candidate = body.candidates && body.candidates[0];
  var textPart = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];

  if (!textPart || !textPart.text) {
    Logger.log('Gemini 응답에서 분류 결과를 찾지 못했습니다: ' + response.getContentText());
    return null;
  }

  var input = JSON.parse(textPart.text);
  return {
    topic: input.topic,
    sentiment: input.sentiment,
    hasProfanity: input.has_profanity,
    profanityNote: input.profanity_note || ''
  };
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
 * 주어진 저장소 파일 경로에 대한 GitHub Contents API 접속 정보를 만든다.
 */
function getGithubConfig(filePath) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GITHUB_TOKEN');
  var owner = props.getProperty('GITHUB_OWNER');
  var repo = props.getProperty('GITHUB_REPO');
  var branch = props.getProperty('GITHUB_BRANCH') || DEFAULT_BRANCH;

  if (!token || !owner || !repo) {
    throw new Error('스크립트 속성에 GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO를 먼저 설정하세요.');
  }

  return {
    branch: branch,
    apiUrl: 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + filePath,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json'
    }
  };
}

function getResponsesFilePath() {
  return PropertiesService.getScriptProperties().getProperty('GITHUB_FILE_PATH') || DEFAULT_FILE_PATH;
}

function getHiddenFilePath() {
  return PropertiesService.getScriptProperties().getProperty('GITHUB_HIDDEN_FILE_PATH') || DEFAULT_HIDDEN_FILE_PATH;
}

/**
 * GitHub에서 JSON 배열 파일을 읽는다. 파일이 아직 없으면(첫 실행) 빈 배열을 반환한다.
 */
function readJsonFile(config) {
  var data = [];
  var sha = null;

  var getResponse = UrlFetchApp.fetch(config.apiUrl + '?ref=' + config.branch, {
    method: 'get',
    headers: config.headers,
    muteHttpExceptions: true
  });

  if (getResponse.getResponseCode() === 200) {
    var fileData = JSON.parse(getResponse.getContentText());
    sha = fileData.sha;
    var decodedBytes = Utilities.base64Decode(fileData.content.replace(/\n/g, ''));
    var decodedText = Utilities.newBlob(decodedBytes).getDataAsString('UTF-8');
    data = JSON.parse(decodedText);
  } else if (getResponse.getResponseCode() !== 404) {
    throw new Error('GitHub 파일 조회 실패 (' + getResponse.getResponseCode() + '): ' + getResponse.getContentText());
  }

  return { data: data, sha: sha };
}

/**
 * JSON 배열을 GitHub 파일에 커밋한다.
 */
function writeJsonFile(config, data, sha, message) {
  var updatedContent = JSON.stringify(data, null, 2);
  var encodedContent = Utilities.base64Encode(Utilities.newBlob(updatedContent, 'application/json').getBytes());

  var putPayload = {
    message: message,
    content: encodedContent,
    branch: config.branch
  };
  if (sha) {
    putPayload.sha = sha;
  }

  var putResponse = UrlFetchApp.fetch(config.apiUrl, {
    method: 'put',
    headers: config.headers,
    contentType: 'application/json',
    payload: JSON.stringify(putPayload),
    muteHttpExceptions: true
  });

  var putCode = putResponse.getResponseCode();
  if (putCode !== 200 && putCode !== 201) {
    throw new Error('GitHub 파일 커밋 실패 (' + putCode + '): ' + putResponse.getContentText());
  }

  Logger.log('GitHub 커밋 성공 (' + config.apiUrl + '): ' + putCode);
}

/**
 * responses.json에 새 응답 항목을 추가하고 커밋한다.
 */
function updateGithubFile(newEntry) {
  var config = getGithubConfig(getResponsesFilePath());
  var file = readJsonFile(config);
  file.data.push(newEntry);
  writeJsonFile(config, file.data, file.sha, '설문 응답 추가 (' + newEntry.timestamp + ')');
}

/**
 * responses.json에서 해당 timestamp 항목을 제거하고, hiddenAt을 붙여 hidden.json으로 옮긴다.
 */
function hideEntry(timestamp) {
  var responsesConfig = getGithubConfig(getResponsesFilePath());
  var responsesFile = readJsonFile(responsesConfig);

  var index = -1;
  for (var i = 0; i < responsesFile.data.length; i++) {
    if (responsesFile.data[i].timestamp === timestamp) {
      index = i;
      break;
    }
  }
  if (index === -1) {
    return { ok: false, error: 'NOT_FOUND' };
  }

  var entry = responsesFile.data[index];
  responsesFile.data.splice(index, 1);
  writeJsonFile(responsesConfig, responsesFile.data, responsesFile.sha, '응답 숨김 처리 (' + timestamp + ')');

  entry.hiddenAt = new Date().toISOString();

  var hiddenConfig = getGithubConfig(getHiddenFilePath());
  var hiddenFile = readJsonFile(hiddenConfig);
  hiddenFile.data.push(entry);
  writeJsonFile(hiddenConfig, hiddenFile.data, hiddenFile.sha, '숨김 의견함에 추가 (' + timestamp + ')');

  return { ok: true };
}

/**
 * hidden.json에서 해당 timestamp 항목을 제거하고, hiddenAt을 뗀 뒤 responses.json으로 되돌린다.
 */
function restoreEntry(timestamp) {
  var hiddenConfig = getGithubConfig(getHiddenFilePath());
  var hiddenFile = readJsonFile(hiddenConfig);

  var index = -1;
  for (var i = 0; i < hiddenFile.data.length; i++) {
    if (hiddenFile.data[i].timestamp === timestamp) {
      index = i;
      break;
    }
  }
  if (index === -1) {
    return { ok: false, error: 'NOT_FOUND' };
  }

  var entry = hiddenFile.data[index];
  hiddenFile.data.splice(index, 1);
  writeJsonFile(hiddenConfig, hiddenFile.data, hiddenFile.sha, '숨김 의견함에서 복원 (' + timestamp + ')');

  delete entry.hiddenAt;

  var responsesConfig = getGithubConfig(getResponsesFilePath());
  var responsesFile = readJsonFile(responsesConfig);
  responsesFile.data.push(entry);
  writeJsonFile(responsesConfig, responsesFile.data, responsesFile.sha, '응답 복원 (' + timestamp + ')');

  return { ok: true };
}

/**
 * 현재 숨김 의견함 목록을 반환한다.
 */
function listHidden() {
  var hiddenConfig = getGithubConfig(getHiddenFilePath());
  var hiddenFile = readJsonFile(hiddenConfig);
  return { ok: true, hidden: hiddenFile.data };
}

/**
 * 숨김 의견함에서 HIDDEN_RETENTION_DAYS(기본 10일)가 지난 항목을 완전히 삭제한다.
 * 매일 실행되는 시간 기반 트리거로 등록해서 사용한다 (createPurgeTrigger 참고).
 */
function purgeExpiredHidden() {
  var hiddenConfig = getGithubConfig(getHiddenFilePath());
  var hiddenFile = readJsonFile(hiddenConfig);

  var cutoff = Date.now() - HIDDEN_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  var remaining = hiddenFile.data.filter(function (entry) {
    var hiddenAt = new Date(entry.hiddenAt).getTime();
    return isNaN(hiddenAt) || hiddenAt > cutoff;
  });

  if (remaining.length === hiddenFile.data.length) {
    Logger.log('숨김 의견함: 삭제할 만료 항목이 없습니다.');
    return;
  }

  var removedCount = hiddenFile.data.length - remaining.length;
  writeJsonFile(hiddenConfig, remaining, hiddenFile.sha, '숨김 의견함 만료 항목 정리 (' + removedCount + '건 삭제)');
  Logger.log('숨김 의견함: 만료된 ' + removedCount + '건을 삭제했습니다.');
}

/**
 * purgeExpiredHidden을 매일 실행하는 시간 기반 트리거를 등록하는 설치용 함수.
 */
function createPurgeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'purgeExpiredHidden') {
      Logger.log('purgeExpiredHidden 트리거가 이미 등록되어 있습니다.');
      return;
    }
  }

  ScriptApp.newTrigger('purgeExpiredHidden')
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();

  Logger.log('purgeExpiredHidden 일일 트리거 등록 완료.');
}

/**
 * 웹 앱(POST) 엔드포인트. 사이트의 관리자 모드에서 의견 숨기기/복원/조회 요청을 처리한다.
 * 요청 본문(JSON): { action: 'verify'|'list'|'hide'|'restore', password, timestamp }
 */
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ ok: false, error: 'INVALID_BODY' });
  }

  var adminPassword = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!adminPassword || body.password !== adminPassword) {
    return jsonOutput({ ok: false, error: 'UNAUTHORIZED' });
  }

  try {
    if (body.action === 'verify') {
      return jsonOutput({ ok: true });
    }
    if (body.action === 'list') {
      return jsonOutput(listHidden());
    }
    if (body.action === 'hide' && body.timestamp) {
      return jsonOutput(hideEntry(body.timestamp));
    }
    if (body.action === 'restore' && body.timestamp) {
      return jsonOutput(restoreEntry(body.timestamp));
    }
    return jsonOutput({ ok: false, error: 'UNKNOWN_ACTION' });
  } catch (err) {
    Logger.log('doPost 처리 실패: ' + err);
    return jsonOutput({ ok: false, error: 'SERVER_ERROR' });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
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

/**
 * GitHub에 커밋하지 않고 Gemini 분류 로직만 즉시 테스트하는 함수.
 * 실행 후 로그(보기 > 로그)에서 분류 결과를 확인한다.
 */
function manualClassifyTest() {
  var dummyEntry = {
    timestamp: new Date().toISOString(),
    answers: {
      '의견': '이 XX 앱 로딩 왜 이렇게 느려? 진짜 답답하네.'
    }
  };

  var result = classifyEntry(dummyEntry);
  Logger.log(JSON.stringify(result, null, 2));
}
