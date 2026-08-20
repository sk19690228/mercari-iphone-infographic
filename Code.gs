/**
 * Mercari Gmail notification relay for Google Apps Script.
 *
 * Script properties:
 *   APP_TOKEN  required: same value as the PWA relay token
 *   MAIL_QUERY optional: custom Gmail search expression
 */

var PROCESSED_MESSAGE_IDS_KEY = 'PROCESSED_MESSAGE_IDS_V35';
var SEEN_ITEM_IDS_KEY = 'SEEN_ITEM_IDS_V35';
var AVG_PRICES_KEY = 'AVG_PRICES_V1';
var CODE_VERSION = '36';
var DEFAULT_MAIL_QUERY = '{from:mercari.jp from:mercari.com subject:メルカリ "メルカリ"}';
var USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';

function doGet(e) {
  var p = e && e.parameter ? e.parameter : {};
  var callback = safeCallback_(p.callback);
  try {
    verifyToken_(p.token || '');
    var action = String(p.action || 'health');
    var result;
    if (action === 'health') result = health_();
    else if (action === 'searchMail') result = searchMail_(p);
    else if (action === 'resetProcessed') result = resetProcessed_();
    else if (action === 'getAppConfig') result = getAppConfig_();
    else if (action === 'saveAvgPrices') result = saveAvgPrices_(p.data);
    else if (action === 'fetchItem') result = fetchItem_(p.url);
    else throw new Error('未対応の処理です: ' + action);
    result = result || {};
    result.ok = true;
    return output_(result, callback);
  } catch (err) {
    return output_({ok:false, error:String(err && err.message ? err.message : err)}, callback);
  }
}

function authorizeGmail() {
  return {
    unreadCount: GmailApp.getInboxUnreadCount(),
    checkedAt: new Date().toISOString()
  };
}

function health_() {
  var props = PropertiesService.getScriptProperties();
  var custom = String(props.getProperty('MAIL_QUERY') || '').trim();
  var query = buildMailQuery_(3, custom);
  var threads = GmailApp.search(query, 0, 10);
  return {
    provider: 'Gmail通知中継 v' + CODE_VERSION,
    projectId: ScriptApp.getScriptId(),
    matchingThreads: threads.length,
    checkedAt: new Date().toISOString(),
    customQuery: !!custom
  };
}

function verifyToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('APP_TOKEN') || '';
  if (!expected) throw new Error('スクリプトプロパティにAPP_TOKENを設定してください');
  if (String(token) !== String(expected)) throw new Error('中継用トークンが一致しません');
}

function safeCallback_(value) {
  var callback = String(value || '');
  return /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback) ? callback : '';
}

function output_(data, callback) {
  var json = JSON.stringify(data).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function buildMailQuery_(days, customQuery) {
  var base = String(customQuery || '').trim() || DEFAULT_MAIL_QUERY;
  return 'newer_than:' + clamp_(days, 1, 30, 14) + 'd -in:spam -in:trash ' + base;
}

function searchMail_(p) {
  var started = Date.now();
  var days = clamp_(p.days, 1, 30, 14);
  var maxThreads = clamp_(p.max_threads, 1, 100, 50);
  var maxItems = clamp_(p.max_items, 1, 100, 40);
  var markProcessed = String(p.mark_processed || '1') === '1';
  var props = PropertiesService.getScriptProperties();
  var query = buildMailQuery_(days, props.getProperty('MAIL_QUERY'));
  var threads = GmailApp.search(query, 0, maxThreads);
  var messages = [];
  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(message) { messages.push(message); });
  });
  messages.sort(function(a, b) { return b.getDate().getTime() - a.getDate().getTime(); });

  var processed = readIdMap_(props, PROCESSED_MESSAGE_IDS_KEY);
  var seen = readIdMap_(props, SEEN_ITEM_IDS_KEY);
  var skippedProcessed = 0;
  var skippedSeenItems = 0;
  var unparsedMessages = 0;
  var unprocessedMessages = 0;
  var messageRecords = [];
  var directItemUrls = [];
  var listPageUrls = [];
  var contextByUrl = {};
  var warnings = [];

  messages.forEach(function(message) {
    var id = String(message.getId());
    if (processed[id]) { skippedProcessed++; return; }
    unprocessedMessages++;
    var subject = safeCall_(function() { return message.getSubject(); }, '');
    var plain = safeCall_(function() { return message.getPlainBody(); }, '');
    var html = safeCall_(function() { return message.getBody(); }, '');
    var record = {
      id: id,
      message: message,
      subject: String(subject || ''),
      plain: String(plain || ''),
      html: String(html || ''),
      date: message.getDate(),
      detected: false
    };
    var extracted = extractMercariLinks_(record.html + '\n' + record.plain);
    extracted.items.forEach(function(url) {
      directItemUrls.push(url);
      if (!contextByUrl[url]) contextByUrl[url] = record;
      record.detected = true;
    });
    extracted.lists.forEach(function(url) {
      listPageUrls.push(url);
      if (!contextByUrl[url]) contextByUrl[url] = record;
      record.detected = true;
    });
    if (!record.detected) unparsedMessages++;
    messageRecords.push(record);
  });

  directItemUrls = unique_(directItemUrls);
  listPageUrls = unique_(listPageUrls).slice(0, 10);
  var listPagesFetched = 0;
  var listItemsFound = 0;
  if (listPageUrls.length) {
    var listResponses = fetchAllSafe_(listPageUrls);
    listResponses.forEach(function(entry, index) {
      if (!entry.ok) {
        warnings.push('商品一覧ページを取得できませんでした: ' + shortUrl_(listPageUrls[index]));
        return;
      }
      listPagesFetched++;
      var links = extractMercariLinks_(entry.text).items;
      listItemsFound += links.length;
      links.forEach(function(url) {
        directItemUrls.push(url);
        if (!contextByUrl[url]) contextByUrl[url] = contextByUrl[listPageUrls[index]] || null;
      });
    });
  }

  directItemUrls = unique_(directItemUrls);
  var freshUrls = [];
  directItemUrls.forEach(function(url) {
    var itemId = itemIdFromUrl_(url);
    if (itemId && seen[itemId]) { skippedSeenItems++; return; }
    if (freshUrls.length < maxItems) freshUrls.push(url);
  });

  var responses = fetchAllSafe_(freshUrls);
  var items = [];
  var successfullyHandledMessageIds = {};
  responses.forEach(function(entry, index) {
    var url = freshUrls[index];
    var context = contextByUrl[url] || null;
    var item = entry.ok ? parseMercariItem_(entry.text, url, context) : parseMailFallback_(url, context);
    if (!entry.ok) warnings.push('商品ページを取得できないためメール本文を使用: ' + shortUrl_(url));
    if (!item || !item.url) return;
    items.push(item);
    var usable = !!(item.price || item.model || item.storage || (item.title && item.title !== 'メルカリ新着商品'));
    if (usable) {
      var itemId = itemIdFromUrl_(item.url);
      if (itemId) seen[itemId] = Date.now();
      if (context && context.id) successfullyHandledMessageIds[context.id] = true;
    }
  });

  if (markProcessed) {
    var label = GmailApp.getUserLabelByName('iPhoneインフォ/処理済み') || GmailApp.createLabel('iPhoneインフォ/処理済み');
    messageRecords.forEach(function(record) {
      if (record.detected && successfullyHandledMessageIds[record.id]) {
        processed[record.id] = Date.now();
        safeCall_(function() { record.message.getThread().addLabel(label); }, null);
      }
    });
  }
  trimAndWriteIdMap_(props, PROCESSED_MESSAGE_IDS_KEY, processed, 800);
  trimAndWriteIdMap_(props, SEEN_ITEM_IDS_KEY, seen, 1600);

  return {
    items: items,
    scannedMessages: messages.length,
    unprocessedMessages: unprocessedMessages,
    skippedProcessed: skippedProcessed,
    skippedSeenItems: skippedSeenItems,
    unparsedMessages: unparsedMessages,
    listPagesDetected: listPageUrls.length,
    listPagesFetched: listPagesFetched,
    listItemsFound: listItemsFound,
    foundUrls: freshUrls.length,
    remainingDueToLimit: directItemUrls.length - skippedSeenItems > maxItems,
    warnings: unique_(warnings).slice(0, 12),
    elapsedMs: Date.now() - started,
    checkedAt: new Date().toISOString()
  };
}

function fetchAllSafe_(urls) {
  if (!urls.length) return [];
  var requests = urls.map(function(url) {
    return {
      url: url,
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.5',
        'Accept': 'text/html,application/xhtml+xml'
      }
    };
  });
  try {
    var responses = UrlFetchApp.fetchAll(requests);
    return responses.map(function(response) {
      var code = response.getResponseCode();
      return {ok:code >= 200 && code < 400, code:code, text:response.getContentText('UTF-8')};
    });
  } catch (err) {
    return urls.map(function(url) {
      try {
        var response = UrlFetchApp.fetch(url, {
          method:'get', followRedirects:true, muteHttpExceptions:true,
          headers:{'User-Agent':USER_AGENT, 'Accept-Language':'ja-JP,ja;q=0.9,en;q=0.5'}
        });
        var code = response.getResponseCode();
        return {ok:code >= 200 && code < 400, code:code, text:response.getContentText('UTF-8')};
      } catch (inner) {
        return {ok:false, code:0, text:''};
      }
    });
  }
}

function extractMercariLinks_(source) {
  var text = decodeHtml_(String(source || ''));
  var candidates = [];
  var urlPattern = /https?:\/\/[^\s<>"']+/gi;
  var match;
  while ((match = urlPattern.exec(text)) !== null) candidates.push(cleanUrl_(match[0]));
  var hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  while ((match = hrefPattern.exec(text)) !== null) candidates.push(cleanUrl_(match[1]));
  var decoded = decodeUrlDeep_(text);
  while ((match = urlPattern.exec(decoded)) !== null) candidates.push(cleanUrl_(match[0]));

  var items = [];
  var lists = [];
  candidates.forEach(function(candidate) {
    var expanded = decodeUrlDeep_(candidate);
    var itemMatch = expanded.match(/https?:\/\/(?:jp\.)?mercari\.com\/(?:item|shops\/product)\/[A-Za-z0-9_-]+/i);
    if (itemMatch) { items.push(normalizeMercariUrl_(itemMatch[0])); return; }
    var idMatch = expanded.match(/(?:^|[^A-Za-z0-9])(m\d{8,})(?:[^A-Za-z0-9]|$)/i);
    if (idMatch) { items.push('https://jp.mercari.com/item/' + idMatch[1]); return; }
    if (/https?:\/\/(?:jp\.)?mercari\.com\//i.test(expanded) && /(?:search|notification|saved|recommend|category|brand)/i.test(expanded)) {
      lists.push(cleanUrl_(expanded));
    }
  });
  return {items:unique_(items), lists:unique_(lists)};
}

function normalizeMercariUrl_(url) {
  var clean = cleanUrl_(url).replace(/^http:\/\//i, 'https://');
  clean = clean.replace(/^https:\/\/mercari\.com\//i, 'https://jp.mercari.com/');
  return clean.split('#')[0].split('?')[0];
}

function cleanUrl_(url) {
  return decodeHtml_(String(url || ''))
    .replace(/[\]\[(){}>,.;]+$/g, '')
    .replace(/&(?:amp;)?$/i, '');
}

function decodeUrlDeep_(value) {
  var current = decodeHtml_(String(value || ''));
  for (var i = 0; i < 4; i++) {
    try {
      var next = decodeURIComponent(current.replace(/\+/g, '%20'));
      if (next === current) break;
      current = next;
    } catch (err) { break; }
  }
  return current;
}

function parseMercariItem_(html, url, context) {
  var title = firstNonEmpty_([
    metaContent_(html, 'property', 'og:title'),
    metaContent_(html, 'name', 'twitter:title'),
    bestJsonString_(html, ['name','itemName','title'], scoreTitle_),
    context ? context.subject : ''
  ]);
  title = cleanTitle_(title);
  var description = bestJsonString_(html, ['description','itemDescription'], scoreDescription_);
  if (!description) description = metaContent_(html, 'property', 'og:description');
  var image = firstNonEmpty_([
    metaContent_(html, 'property', 'og:image'),
    metaContent_(html, 'name', 'twitter:image'),
    bestJsonString_(html, ['image','imageUrl','thumbnail'], scoreImage_)
  ]);
  var price = extractPrice_(html);
  var contextText = context ? (context.subject + '\n' + context.plain + '\n' + stripTags_(context.html)) : '';
  if (!price) price = extractPrice_(contextText);
  if (!description && contextText) description = contextText;
  return buildItem_(url, title, description, image, price, context);
}

function parseMailFallback_(url, context) {
  if (!context) return buildItem_(url, '', '', '', 0, null);
  var text = context.subject + '\n' + context.plain + '\n' + stripTags_(context.html);
  var title = extractNearbyTitle_(context.html, url) || context.subject;
  var image = extractNearbyImage_(context.html, url);
  return buildItem_(url, title, text, image, extractPrice_(text), context);
}

function buildItem_(url, title, description, image, price, context) {
  var cleanDescription = sanitizeDescription_(description);
  var combined = [title, cleanDescription, context ? context.subject : ''].join(' ');
  return {
    url: normalizeMercariUrl_(url),
    title: cleanTitle_(title) || 'メルカリ新着商品',
    description: cleanDescription,
    bodyText: cleanDescription,
    image: cleanUrl_(image),
    images: image ? [cleanUrl_(image)] : [],
    price: Number(price) || 0,
    model: detectModel_(combined),
    storage: detectStorage_(combined),
    color: detectColor_(combined),
    condition: detectCondition_(combined),
    sourceSubject: context ? context.subject : '',
    sourceDate: context && context.date ? context.date.toISOString() : '',
    detailFetched: !!description
  };
}

function fetchItem_(url) {
  var normalized = normalizeMercariUrl_(url);
  if (!/^https:\/\/(?:jp\.)?mercari\.com\/(?:item|shops\/product)\//i.test(normalized)) {
    throw new Error('メルカリ商品URLを確認できません');
  }
  var response = fetchAllSafe_([normalized])[0];
  if (!response || !response.ok) throw new Error('商品ページを取得できませんでした');
  var item = parseMercariItem_(response.text, normalized, null);
  return {item:item};
}

function extractPrice_(text) {
  var source = String(text || '');
  var patterns = [
    /"price"\s*:\s*"?(\d{3,9})"?/i,
    /(?:販売価格|商品価格|価格)[^\d]{0,20}[¥￥]?\s*([\d,]{3,12})\s*円?/i,
    /[¥￥]\s*([\d,]{3,12})/,
    /([\d,]{3,12})\s*円/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var match = source.match(patterns[i]);
    if (match) {
      var value = Number(match[1].replace(/,/g, ''));
      if (value >= 1000 && value <= 999999999) return value;
    }
  }
  return 0;
}

function metaContent_(html, attr, value) {
  var escaped = escapeRegExp_(value);
  var patterns = [
    new RegExp('<meta[^>]*' + attr + '=["\\\']' + escaped + '["\\\'][^>]*content=["\\\']([^"\\\']*)["\\\'][^>]*>', 'i'),
    new RegExp('<meta[^>]*content=["\\\']([^"\\\']*)["\\\'][^>]*' + attr + '=["\\\']' + escaped + '["\\\'][^>]*>', 'i')
  ];
  for (var i = 0; i < patterns.length; i++) {
    var match = String(html || '').match(patterns[i]);
    if (match) return decodeHtml_(match[1]);
  }
  return '';
}

function bestJsonString_(html, keys, scorer) {
  var candidates = [];
  keys.forEach(function(key) {
    var pattern = new RegExp('"' + escapeRegExp_(key) + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"', 'gi');
    var match;
    while ((match = pattern.exec(String(html || ''))) !== null && candidates.length < 120) {
      try { candidates.push(JSON.parse('"' + match[1] + '"')); }
      catch (err) { candidates.push(match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')); }
    }
  });
  candidates = candidates.map(function(value) { return decodeHtml_(value); }).filter(Boolean);
  candidates.sort(function(a, b) { return scorer(b) - scorer(a); });
  return candidates[0] || '';
}

function scoreTitle_(text) {
  var value = String(text || '');
  var score = Math.min(value.length, 100);
  if (/iPhone/i.test(value)) score += 100;
  if (/\d+\s*(?:GB|TB)/i.test(value)) score += 40;
  if (/メルカリ|ログイン|検索|持ち物/i.test(value)) score -= 80;
  return score;
}

function scoreDescription_(text) {
  var value = String(text || '');
  var score = Math.min(value.length, 600);
  if (/バッテリー|付属品|傷|動作|使用|SIM|充放電/i.test(value)) score += 180;
  if (/itemInformation|pageHeading|Mercari ambassador|クレジットカード/i.test(value)) score -= 400;
  return score;
}

function scoreImage_(text) {
  var value = String(text || '');
  var score = /^https?:\/\//i.test(value) ? 100 : 0;
  if (/static|image|mercdn/i.test(value)) score += 30;
  return score;
}

function extractNearbyTitle_(html, url) {
  var source = String(html || '');
  var itemId = itemIdFromUrl_(url);
  var index = itemId ? source.indexOf(itemId) : -1;
  if (index < 0) return '';
  var around = source.slice(Math.max(0, index - 1200), index + 1200);
  var anchor = around.match(/<a[^>]*>[\s\S]*?<\/a>/i);
  return anchor ? stripTags_(anchor[0]).trim() : '';
}

function extractNearbyImage_(html, url) {
  var source = String(html || '');
  var itemId = itemIdFromUrl_(url);
  var index = itemId ? source.indexOf(itemId) : -1;
  if (index < 0) return '';
  var around = source.slice(Math.max(0, index - 1600), index + 1600);
  var image = around.match(/<img[^>]+src=["']([^"']+)["']/i);
  return image ? decodeHtml_(image[1]) : '';
}

function itemIdFromUrl_(url) {
  var match = String(url || '').match(/\/(m\d{8,})(?:[/?#]|$)/i);
  if (match) return match[1].toLowerCase();
  match = String(url || '').match(/\/shops\/product\/([A-Za-z0-9_-]+)/i);
  return match ? 'shop_' + match[1].toLowerCase() : '';
}

function detectModel_(text) {
  var match = String(text || '').match(/iPhone\s*(SE\s*\(?第?[23]世代\)?|(?:1[0-7]|[8X])(?:\s*(?:mini|Plus|Pro\s*Max|Pro|e))?)/i);
  if (!match) return '';
  return ('iPhone ' + match[1]).replace(/\s+/g, ' ').replace(/pro max/i, 'Pro Max').replace(/pro/i, 'Pro').replace(/plus/i, 'Plus').replace(/mini/i, 'mini');
}

function detectStorage_(text) {
  var match = String(text || '').match(/(?:^|\D)(16|32|64|128|256|512)\s*(?:GB|G|ギガ)(?:\D|$)/i);
  if (match) return match[1] + 'GB';
  match = String(text || '').match(/(?:^|\D)(1|2)\s*TB(?:\D|$)/i);
  return match ? match[1] + 'TB' : '';
}

function detectCondition_(text) {
  var conditions = ['新品、未使用','新品・未使用','未使用に近い','目立った傷や汚れなし','やや傷や汚れあり','傷や汚れあり','全体的に状態が悪い'];
  for (var i = 0; i < conditions.length; i++) if (String(text || '').indexOf(conditions[i]) >= 0) return conditions[i].replace('・', '、');
  return '';
}

function detectColor_(text) {
  var colors = ['ブラック','ホワイト','ブルー','グリーン','ピンク','イエロー','パープル','レッド','シルバー','ゴールド','グラファイト','ナチュラルチタニウム','デザートチタニウム','ホワイトチタニウム','ブラックチタニウム','ウルトラマリン','ティール'];
  for (var i = 0; i < colors.length; i++) if (String(text || '').indexOf(colors[i]) >= 0) return colors[i];
  return '';
}

function sanitizeDescription_(text) {
  return stripTags_(String(text || ''))
    .replace(/\\u([0-9a-fA-F]{4})/g, function(_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 5000);
}

function cleanTitle_(text) {
  return decodeHtml_(stripTags_(String(text || '')))
    .replace(/[｜|]\s*メルカリ.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function stripTags_(html) {
  return decodeHtml_(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

function decodeHtml_(text) {
  return String(text || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function(_, n) { return String.fromCharCode(parseInt(n, 16)); });
}

function saveAvgPrices_(raw) {
  var parsed;
  try { parsed = JSON.parse(String(raw || '{}')); }
  catch (err) { throw new Error('中古平均価格データの形式が正しくありません'); }
  var clean = {};
  Object.keys(parsed || {}).slice(0, 500).forEach(function(key) {
    var value = Number(parsed[key]);
    if (value > 0 && value < 10000000) clean[String(key).slice(0, 100)] = Math.round(value);
  });
  var incomingCount = Object.keys(clean).length;
  if (!incomingCount) throw new Error('空の中古平均価格データではGASの保存内容を上書きしません');
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var existing = {};
    try { existing = JSON.parse(props.getProperty(AVG_PRICES_KEY) || '{}'); }
    catch (err) { existing = {}; }
    var merged = {};
    Object.keys(existing || {}).forEach(function(key) {
      var value = Number(existing[key]);
      if (value > 0 && value < 10000000) merged[String(key).slice(0, 100)] = Math.round(value);
    });
    Object.keys(clean).forEach(function(key) { merged[key] = clean[key]; });
    props.setProperty(AVG_PRICES_KEY, JSON.stringify(merged));
    return {saved:incomingCount, total:Object.keys(merged).length, mode:'merge'};
  } finally {
    lock.releaseLock();
  }
}

function getAppConfig_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AVG_PRICES_KEY) || '{}';
  var avgPrices = {};
  try { avgPrices = JSON.parse(raw); } catch (err) { avgPrices = {}; }
  return {avgPrices:avgPrices};
}

function resetProcessed_() {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // APP_TOKEN、MAIL_QUERY、中古平均価格には触れず、履歴2項目だけを空にします。
    props.setProperty(PROCESSED_MESSAGE_IDS_KEY, '{}');
    props.setProperty(SEEN_ITEM_IDS_KEY, '{}');
  } finally {
    lock.releaseLock();
  }
  return {reset:true, note:'処理済みメール・商品IDの履歴だけを空にしました。APP_TOKEN・検索条件・中古平均価格は保持しています。'};
}

function readIdMap_(props, key) {
  try {
    var parsed = JSON.parse(props.getProperty(key) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) { return {}; }
}

function trimAndWriteIdMap_(props, key, map, limit) {
  var entries = Object.keys(map).map(function(id) { return [id, Number(map[id]) || 0]; });
  entries.sort(function(a, b) { return b[1] - a[1]; });
  var trimmed = {};
  entries.slice(0, limit).forEach(function(entry) { trimmed[entry[0]] = entry[1]; });
  props.setProperty(key, JSON.stringify(trimmed));
}

function unique_(items) {
  var seen = {};
  return (items || []).filter(function(item) {
    var key = String(item || '');
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function firstNonEmpty_(items) {
  for (var i = 0; i < items.length; i++) if (String(items[i] || '').trim()) return String(items[i]).trim();
  return '';
}

function clamp_(value, min, max, fallback) {
  var number = Number(value);
  if (!isFinite(number)) number = fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function safeCall_(fn, fallback) {
  try { return fn(); } catch (err) { return fallback; }
}

function escapeRegExp_(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shortUrl_(url) {
  var value = String(url || '');
  return value.length > 90 ? value.slice(0, 87) + '...' : value;
}
